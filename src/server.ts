import express, { type Request, type Response } from "express";
import twilio from "twilio";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { store } from "./store.js";
import { createMcpServer } from "./mcp.js";
import { buildOutboundTwiml, buildCollectTwiml, buildRepromptTwiml } from "./twiml.js";
import { buildOAuthRouter, verifyAccessToken } from "./oauth.js";
import { buildAccountRouter } from "./account.js";
import { buildSiteRouter } from "./site.js";
import { handleWebhook } from "./billing.js";
import { initSchema } from "./db.js";
import { sendSms, buildFallbackSms } from "./messaging.js";
import type { CallStatus, CallRecord } from "./store.js";

const app = express();
app.disable("x-powered-by");

// Stripe webhook MUST see the raw body for signature verification, so it's
// registered before any JSON body parsing.
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.header("stripe-signature") ?? "";
  try {
    await handleWebhook(req.body as Buffer, sig);
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe] webhook error:", err);
    res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : "invalid"}`);
  }
});

// OAuth 2.1 endpoints (discovery, registration, authorize, token). Mounted only
// when configured, so a private static-token setup stays simple.
if (config.oauth.enabled) {
  app.use(buildOAuthRouter());
}

// Customer account page (sign in, subscribe, manage billing) in multi-tenant mode.
if (config.multiTenant) {
  app.use(buildAccountRouter());
}

// ---------------------------------------------------------------------------
// Marketing site (landing, pricing, privacy, terms) + /healthz
// ---------------------------------------------------------------------------
app.use(buildSiteRouter());

// ---------------------------------------------------------------------------
// MCP endpoint (Streamable HTTP, stateless) — this is the connector URL you
// register with Claude / ChatGPT.
// ---------------------------------------------------------------------------
/** Returns the authenticated user's id, or null after writing a 401. */
async function resolveUser(req: Request, res: Response): Promise<string | null> {
  const header = req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (config.oauth.enabled && bearer) {
    const userId = await verifyAccessToken(bearer);
    if (userId) return userId;
  }

  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: missing or invalid credentials." },
    id: null,
  });
  return null;
}

app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
  const userId = await resolveUser(req, res);
  if (!userId) return;
  // Stateless: a fresh server + transport per request, bound to this user.
  const server = createMcpServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error." },
        id: null,
      });
    }
  }
});

// GET/DELETE on /mcp aren't used in stateless mode (no server-initiated SSE).
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// ---------------------------------------------------------------------------
// Twilio voice webhooks
// ---------------------------------------------------------------------------
const twilioBody = express.urlencoded({ extended: false });

/**
 * Verify the request really came from Twilio (signed with your auth token).
 * The signature is computed over the FULL public URL, so we reconstruct it from
 * PUBLIC_URL + the original path/query rather than trusting proxy headers.
 */
function verifyTwilio(req: Request, res: Response): boolean {
  if (!config.validateTwilioSignature) return true;
  const signature = req.header("x-twilio-signature") ?? "";
  const url = `${config.publicUrl}${req.originalUrl}`;
  const valid = twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    req.body as Record<string, string>
  );
  if (!valid) {
    console.warn("[twilio] rejected request with invalid signature:", req.originalUrl);
    res.status(403).type("text/plain").send("Invalid Twilio signature.");
    return false;
  }
  return true;
}

// Played when the callee answers: read the update, then gather speech.
app.post("/voice/outbound", twilioBody, (req, res) => {
  if (!verifyTwilio(req, res)) return;
  const callId = String(req.query.callId ?? "");
  const rec = store.get(callId);
  if (!rec) {
    const vr = new twilio.twiml.VoiceResponse();
    vr.say("Sorry, this call has expired. Goodbye.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }
  store.update(callId, { status: "in-progress" });
  const collectUrl = `${config.publicUrl}/voice/collect?callId=${encodeURIComponent(callId)}`;
  res.type("text/xml").send(buildOutboundTwiml(rec, collectUrl));
});

// Phrases that end a conversational call.
const STOP_WORDS = /\b(that'?s all|that is all|i'?m done|we'?re done|all done|nothing else|no more|no that'?s it|that'?s it|goodbye|good bye|hang up|finished|^done$|^stop$)\b/i;
const MAX_TURNS = 8;

// Receives the transcribed speech (or digits) from the <Gather>.
app.post("/voice/collect", twilioBody, (req, res) => {
  if (!verifyTwilio(req, res)) return;
  const callId = String(req.query.callId ?? "");
  const rec = store.get(callId);
  if (!rec) {
    return res.type("text/xml").send(buildCollectTwiml(undefined));
  }

  const speech = typeof req.body.SpeechResult === "string" ? req.body.SpeechResult : "";
  const digits = typeof req.body.Digits === "string" ? req.body.Digits : "";
  const confidence = req.body.Confidence ? Number(req.body.Confidence) : undefined;
  const utterance = speech || (digits ? `Pressed key(s): ${digits}` : "");
  const silent = req.query.silent === "1" || !utterance;

  if (!rec.conversational) {
    // One-shot: capture the single reply and end.
    if (utterance) store.update(callId, { transcript: utterance, confidence });
    return res.type("text/xml").send(buildCollectTwiml(utterance));
  }

  // Conversational: accumulate turns until the user signals they're done.
  if (utterance) store.addTurn(callId, utterance);
  if (confidence != null) store.update(callId, { confidence });

  const saidStop = STOP_WORDS.test(utterance);
  const reachedMax = rec.turns.length >= MAX_TURNS;
  if (silent || saidStop || reachedMax) {
    const finalized = store.finalize(callId);
    return res.type("text/xml").send(buildCollectTwiml(finalized?.transcript));
  }

  const collectUrl = `${config.publicUrl}/voice/collect?callId=${encodeURIComponent(callId)}`;
  return res.type("text/xml").send(buildRepromptTwiml(collectUrl));
});

// Call lifecycle events (ringing, answered, completed, failed, ...).
app.post("/voice/status", twilioBody, (req, res) => {
  if (!verifyTwilio(req, res)) return;
  const callId = String(req.query.callId ?? "");
  const raw = String(req.body.CallStatus ?? "");
  const map: Record<string, CallStatus> = {
    queued: "queued",
    initiated: "queued",
    ringing: "ringing",
    "in-progress": "in-progress",
    answered: "in-progress",
    completed: "completed",
    busy: "busy",
    "no-answer": "no-answer",
    failed: "failed",
    canceled: "canceled",
  };
  const status = map[raw];
  const rec = store.get(callId);
  if (status && rec) {
    store.update(callId, { status });
    // If the caller hung up mid-conversation, keep whatever they already said.
    if (status === "completed" && rec.conversational) {
      store.finalize(callId);
    }
    // Pro SMS fallback: they didn't pick up → text them the summary. Mark it
    // synchronously so the waiting tool reports "texted you" instead of "no answer",
    // then send in the background.
    const missed = status === "no-answer" || status === "busy" || status === "failed";
    if (missed && rec.smsEligible && !rec.smsFallback && config.smsEnabled && rec.summary) {
      store.update(callId, { smsFallback: true });
      void sendFallbackSms(rec);
    }
  }
  res.sendStatus(204);
});

/** Text the summary to a caller who didn't answer. smsFallback is already set. */
async function sendFallbackSms(rec: CallRecord): Promise<void> {
  try {
    const sid = await sendSms(rec.to, buildFallbackSms(rec));
    store.update(rec.id, { smsSid: sid });
  } catch (err) {
    console.error("[sms] fallback send failed:", err);
    store.update(rec.id, { smsFallback: false, error: "SMS fallback failed to send." });
  }
}

// Inbound SMS (Twilio Messaging webhook) — attach a texted reply to its pending call.
app.post("/sms/inbound", twilioBody, (req, res) => {
  if (!verifyTwilio(req, res)) return;
  const from = String(req.body.From ?? "");
  const body = String(req.body.Body ?? "").trim();
  const rec = from ? store.findPendingByPhone(from) : undefined;
  if (rec && body) {
    if (rec.conversational) {
      store.addTurn(rec.id, body);
      store.finalize(rec.id);
    } else {
      store.update(rec.id, { transcript: body });
    }
  }
  // Empty TwiML: acknowledge without auto-replying.
  res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// ---------------------------------------------------------------------------
async function start(): Promise<void> {
  if (config.multiTenant) {
    try {
      await initSchema();
    } catch (err) {
      console.error("[db] schema init failed — check DATABASE_URL:", err);
    }
  }
  app.listen(config.port, () => {
    console.log(`call-me-connector listening on :${config.port}`);
    console.log(`  MCP endpoint:   POST /mcp`);
    console.log(`  Public URL:     ${config.publicUrl || "(PUBLIC_URL not set)"}`);
    console.log(`  Mode:           ${config.multiTenant ? "MULTI-TENANT (per-user accounts)" : "single-user"}`);
    console.log(`  OAuth 2.1:      ${config.oauth.enabled ? "ON" : "OFF"}`);
    console.log(`  Billing:        ${config.billingEnabled ? "ON (Stripe — calls require a subscription)" : "OFF (no paywall yet)"}`);
    if (config.multiTenant && !config.verifyServiceSid) {
      console.warn("  ⚠  TWILIO_VERIFY_SERVICE_SID is not set — phone verification will fail.");
    }
    if (config.oauth.enabled && !config.oauth.signingSecret) {
      console.warn("  ⚠  OAUTH_SIGNING_SECRET is missing — auth will fail.");
    }
    if (!config.publicUrl) {
      console.warn("  ⚠  PUBLIC_URL is empty — Twilio callbacks will fail until it is set.");
    }
  });
}

void start();
