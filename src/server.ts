import express, { type Request, type Response } from "express";
import twilio from "twilio";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { store } from "./store.js";
import { createMcpServer } from "./mcp.js";
import { buildOutboundTwiml, buildCollectTwiml, buildRepromptTwiml } from "./twiml.js";
import { buildOAuthRouter, verifyAccessToken } from "./oauth.js";
import type { CallStatus } from "./store.js";

const app = express();
app.disable("x-powered-by");

// OAuth 2.1 endpoints (discovery, registration, authorize, token). Mounted only
// when configured, so a private static-token setup stays simple.
if (config.oauth.enabled) {
  app.use(buildOAuthRouter());
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({
    name: "call-me-connector",
    status: "ok",
    mcp_endpoint: "/mcp",
    number_locked: !config.allowNumberOverride,
  });
});

// ---------------------------------------------------------------------------
// MCP endpoint (Streamable HTTP, stateless) — this is the connector URL you
// register with Claude / ChatGPT.
// ---------------------------------------------------------------------------
async function checkConnectorAuth(req: Request, res: Response): Promise<boolean> {
  const header = req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  // 1. Legacy static token (personal-use convenience).
  if (config.connectorToken) {
    const alt = req.header("x-connector-token") ?? "";
    if (bearer === config.connectorToken || alt === config.connectorToken) return true;
  }
  // 2. OAuth 2.1 access token.
  if (config.oauth.enabled && bearer && (await verifyAccessToken(bearer))) return true;
  // 3. No auth configured at all → open (dev only).
  if (!config.connectorToken && !config.oauth.enabled) return true;

  // Point clients at the resource metadata so they can start the OAuth flow.
  if (config.oauth.enabled) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`
    );
  }
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: missing or invalid credentials." },
    id: null,
  });
  return false;
}

app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
  if (!(await checkConnectorAuth(req, res))) return;
  // Stateless: a fresh server + transport per request, torn down when it closes.
  const server = createMcpServer();
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
  }
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
app.listen(config.port, () => {
  console.log(`call-me-connector listening on :${config.port}`);
  console.log(`  MCP endpoint:   POST /mcp`);
  console.log(`  Public URL:     ${config.publicUrl || "(PUBLIC_URL not set)"}`);
  console.log(`  Plan tier:      ${config.tier.toUpperCase()}${config.tier === "pro" ? " (conversation mode enabled)" : " (one-shot only)"}`);
  console.log(`  Number lock:    ${config.allowNumberOverride ? "OFF (override allowed)" : "ON (owner only)"}`);
  console.log(`  Static token:   ${config.connectorToken ? "ON" : "OFF"}`);
  console.log(`  OAuth 2.1:      ${config.oauth.enabled ? "ON" : "OFF"}`);
  if (config.oauth.enabled && (!config.oauth.signingSecret || !config.oauth.ownerAccessCode)) {
    console.warn("  ⚠  OAuth is enabled but OAUTH_SIGNING_SECRET or OWNER_ACCESS_CODE is missing — auth will fail.");
  }
  if (!config.publicUrl) {
    console.warn("  ⚠  PUBLIC_URL is empty — Twilio callbacks will fail until it is set.");
  }
});
