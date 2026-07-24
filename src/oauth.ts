import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
import { query } from "./db.js";
import { authenticate, createUser, findById, setPhone, markPhoneVerified } from "./users.js";
import { startVerification, checkVerification, isE164, normalizePhone } from "./verify.js";

/**
 * Multi-tenant OAuth 2.1 authorization server.
 *
 * The consent screen is a real per-user login/signup. First-time users verify
 * their phone number (Twilio Verify) before the connection completes, so
 * call_me always has a confirmed number to ring. Access tokens carry the user's
 * id in `sub`; clients and refresh tokens live in Postgres.
 */

const SCOPE = "call:me";
const ACCESS_TTL_S = 3600; // 1h
const CODE_TTL_MS = 10 * 60 * 1000; // 10m
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const FLOW_TTL = "20m";

const enc = new TextEncoder();
const key = () => enc.encode(config.oauth.signingSecret);
const audience = () => `${config.publicUrl}/mcp`;
const rand = (n = 32) => randomBytes(n).toString("base64url");

// Short-lived auth codes live in memory; clients + refresh tokens are in Postgres.
interface AuthCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}
const authCodes = new Map<string, AuthCode>();

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
async function issueAccessToken(userId: string, scope: string): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer(config.publicUrl)
    .setAudience(audience())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(key());
}

/** Returns the authenticated user's id, or null if the token is invalid. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: config.publicUrl,
      audience: audience(),
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flow token — carries the authorize request (and user progress) across the
// login → phone → verify steps without server-side sessions. Signed, so the
// hidden form field can't be tampered with.
// ---------------------------------------------------------------------------
interface Flow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope: string;
  userId?: string;
  phone?: string;
}
async function signFlow(f: Flow): Promise<string> {
  return new SignJWT({ f } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(FLOW_TTL)
    .sign(key());
}
async function readFlow(token: string): Promise<Flow | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    return (payload as { f?: Flow }).f ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clients + refresh tokens (Postgres)
// ---------------------------------------------------------------------------
interface ClientRow {
  client_id: string;
  redirect_uris: string[];
  name: string | null;
}
async function getClient(id: string): Promise<ClientRow | null> {
  const { rows } = await query<ClientRow>(
    `SELECT client_id, redirect_uris, name FROM oauth_clients WHERE client_id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function storeRefresh(token: string, userId: string, clientId: string, scope: string): Promise<void> {
  await query(
    `INSERT INTO refresh_tokens (token, user_id, client_id, scope, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
    [token, userId, clientId, scope]
  );
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function page(title: string, bodyInner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Call Me</title>
<style>
 :root{color-scheme:light dark}
 body{font-family:system-ui,sans-serif;max-width:26rem;margin:3.5rem auto;padding:0 1.25rem;line-height:1.5}
 h1{font-size:1.35rem;margin-bottom:.25rem} .sub{opacity:.75;margin-top:0}
 form{margin-top:1.5rem;display:grid;gap:.7rem}
 input{padding:.6rem;font-size:1rem;border-radius:.5rem;border:1px solid #8888;width:100%;box-sizing:border-box}
 button{padding:.7rem;font-size:1rem;border:0;border-radius:.5rem;background:#4f46e5;color:#fff;cursor:pointer}
 button.secondary{background:transparent;color:#4f46e5;border:1px solid #4f46e5}
 .err{color:#dc2626;margin-top:1rem} .row{display:grid;gap:.5rem} code{background:#8882;padding:.1rem .3rem;border-radius:.3rem}
</style></head><body>${bodyInner}</body></html>`;
}

function loginPage(flow: string, clientName: string, error?: string): string {
  return page(
    "Sign in",
    `<h1>Connect Call Me</h1>
     <p class="sub"><strong>${esc(clientName)}</strong> wants to call your phone with task updates and read back your spoken replies.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form method="POST" action="/oauth/login">
       <input type="hidden" name="flow" value="${esc(flow)}">
       <label>Email<input type="email" name="email" autocomplete="email" required></label>
       <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
       <div class="row">
         <button type="submit" name="action" value="login">Sign in</button>
         <button type="submit" name="action" value="signup" class="secondary">Create account</button>
       </div>
     </form>
     <p class="sub" style="margin-top:1.5rem;font-size:.85rem">New here? Enter an email + password and tap <em>Create account</em>. Scope: <code>${SCOPE}</code></p>`
  );
}
function phonePage(flow: string, error?: string): string {
  return page(
    "Add your phone",
    `<h1>Your phone number</h1>
     <p class="sub">Enter the number you want the assistant to call. We'll text you a code to confirm it's yours.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form method="POST" action="/oauth/phone">
       <input type="hidden" name="flow" value="${esc(flow)}">
       <label>Phone number<input type="tel" name="phone" placeholder="(312) 555-1234" required></label>
       <p class="sub" style="margin:0;font-size:.85rem">US numbers work as-is; spaces, dashes, and parentheses are fine. Outside the US, start with +.</p>
       <button type="submit">Send code</button>
     </form>`
  );
}
function verifyPage(flow: string, phone: string, error?: string): string {
  return page(
    "Verify",
    `<h1>Enter your code</h1>
     <p class="sub">We sent a 6-digit code to <strong>${esc(phone)}</strong>.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form method="POST" action="/oauth/verify">
       <input type="hidden" name="flow" value="${esc(flow)}">
       <label>Code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
       <button type="submit">Verify &amp; connect</button>
     </form>`
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function cors(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
}

function validateAuthRequest(q: Record<string, string>, client: ClientRow | null): string | null {
  if (q.response_type !== "code") return "response_type must be 'code'";
  if (!client) return "unknown client_id";
  if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) return "redirect_uri not registered";
  if (!q.code_challenge) return "code_challenge is required (PKCE)";
  if (q.code_challenge_method !== "S256") return "code_challenge_method must be 'S256'";
  return null;
}

/** Mint an auth code for a fully-authenticated + phone-verified flow and redirect. */
function issueCodeAndRedirect(res: Response, flow: Flow): void {
  const code = rand(32);
  authCodes.set(code, {
    userId: flow.userId!,
    clientId: flow.client_id,
    redirectUri: flow.redirect_uri,
    codeChallenge: flow.code_challenge,
    scope: flow.scope || SCOPE,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  const url = new URL(flow.redirect_uri);
  url.searchParams.set("code", code);
  if (flow.state) url.searchParams.set("state", flow.state);
  res.redirect(302, url.toString());
}

export function buildOAuthRouter(): Router {
  const router = Router();
  const json = express.json();
  const form = express.urlencoded({ extended: false });

  router.use(cors);
  router.options("*", (_req, res) => res.sendStatus(204));

  const prm = (_req: Request, res: Response) =>
    res.json({
      resource: audience(),
      authorization_servers: [config.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
  router.get("/.well-known/oauth-protected-resource", prm);
  router.get("/.well-known/oauth-protected-resource/mcp", prm);

  const asMeta = () => ({
    issuer: config.publicUrl,
    authorization_endpoint: `${config.publicUrl}/oauth/authorize`,
    token_endpoint: `${config.publicUrl}/oauth/token`,
    registration_endpoint: `${config.publicUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(asMeta()));
  router.get("/.well-known/openid-configuration", (_req, res) => res.json(asMeta()));

  // Dynamic client registration (RFC 7591)
  router.post("/oauth/register", json, async (req, res) => {
    const body = req.body ?? {};
    const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (!redirectUris.length || !redirectUris.every((u) => typeof u === "string" && /^https?:\/\//.test(u))) {
      return res.status(400).json({ error: "invalid_redirect_uri" });
    }
    const clientId = `client_${rand(16)}`;
    const name = typeof body.client_name === "string" ? body.client_name : null;
    await query(`INSERT INTO oauth_clients (client_id, redirect_uris, name) VALUES ($1, $2, $3)`, [
      clientId,
      JSON.stringify(redirectUris),
      name,
    ]);
    res.status(201).json({
      client_id: clientId,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: name,
      scope: SCOPE,
    });
  });

  // Authorize → show login/signup
  router.get("/oauth/authorize", async (req, res) => {
    const q = req.query as Record<string, string>;
    const client = await getClient(q.client_id ?? "");
    const err = validateAuthRequest(q, client);
    if (err) return res.status(400).type("text/plain").send(`invalid_request: ${err}`);
    const flow = await signFlow({
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      code_challenge: q.code_challenge,
      state: q.state,
      scope: q.scope || SCOPE,
    });
    res.type("text/html").send(loginPage(flow, client!.name || "An AI assistant"));
  });

  // Login / signup
  router.post("/oauth/login", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    const flow = await readFlow(b.flow ?? "");
    if (!flow) return res.status(400).type("text/plain").send("Your session expired. Please start over.");
    const client = await getClient(flow.client_id);
    try {
      const user =
        b.action === "signup"
          ? await createUser(b.email ?? "", b.password ?? "")
          : await authenticate(b.email ?? "", b.password ?? "");
      if (!user) {
        return res.status(401).type("text/html").send(loginPage(b.flow, client?.name || "An AI assistant", "Incorrect email or password."));
      }
      const next = { ...flow, userId: user.id };
      if (user.phone_verified && user.phone_e164) {
        return issueCodeAndRedirect(res, next);
      }
      return res.type("text/html").send(phonePage(await signFlow(next)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      return res.status(400).type("text/html").send(loginPage(b.flow, client?.name || "An AI assistant", msg));
    }
  });

  // Submit phone → send code
  router.post("/oauth/phone", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    const flow = await readFlow(b.flow ?? "");
    if (!flow?.userId) return res.status(400).type("text/plain").send("Your session expired. Please start over.");
    const phone = normalizePhone(b.phone ?? "");
    if (!isE164(phone)) {
      return res.status(400).type("text/html").send(phonePage(b.flow, "Enter a valid number, e.g. (312) 555-1234."));
    }
    try {
      await setPhone(flow.userId, phone);
      await startVerification(phone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send a code.";
      return res.status(400).type("text/html").send(phonePage(b.flow, msg));
    }
    return res.type("text/html").send(verifyPage(await signFlow({ ...flow, phone }), phone));
  });

  // Submit code → verify → issue auth code
  router.post("/oauth/verify", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    const flow = await readFlow(b.flow ?? "");
    if (!flow?.userId || !flow.phone) return res.status(400).type("text/plain").send("Your session expired. Please start over.");
    let ok = false;
    try {
      ok = await checkVerification(flow.phone, (b.code ?? "").trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed.";
      return res.status(400).type("text/html").send(verifyPage(b.flow, flow.phone, msg));
    }
    if (!ok) {
      return res.status(400).type("text/html").send(verifyPage(b.flow, flow.phone, "That code wasn't right. Try again."));
    }
    await markPhoneVerified(flow.userId);
    return issueCodeAndRedirect(res, flow);
  });

  // Token endpoint
  router.post("/oauth/token", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    try {
      if (b.grant_type === "authorization_code") return await handleCode(b, res);
      if (b.grant_type === "refresh_token") return await handleRefresh(b, res);
      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch (e) {
      console.error("[oauth] token error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

async function handleCode(b: Record<string, string>, res: Response) {
  const rec = authCodes.get(b.code ?? "");
  if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "unknown or used code" });
  authCodes.delete(b.code);
  if (Date.now() > rec.expiresAt) return res.status(400).json({ error: "invalid_grant", error_description: "code expired" });
  if (b.client_id !== rec.clientId) return res.status(400).json({ error: "invalid_grant", error_description: "client mismatch" });
  if (b.redirect_uri !== rec.redirectUri) return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
  const computed = createHash("sha256").update(b.code_verifier ?? "").digest("base64url");
  if (!b.code_verifier || computed !== rec.codeChallenge) {
    return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
  }
  const accessToken = await issueAccessToken(rec.userId, rec.scope);
  const refresh = rand(48);
  await storeRefresh(refresh, rec.userId, rec.clientId, rec.scope);
  return res.json({ access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: rec.scope });
}

async function handleRefresh(b: Record<string, string>, res: Response) {
  const { rows } = await query<{ user_id: string; client_id: string; scope: string; expired: boolean }>(
    `SELECT user_id, client_id, scope, (expires_at < now()) AS expired FROM refresh_tokens WHERE token = $1`,
    [b.refresh_token ?? ""]
  );
  const rec = rows[0];
  if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "unknown refresh_token" });
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [b.refresh_token]); // rotate
  if (rec.expired) return res.status(400).json({ error: "invalid_grant", error_description: "refresh_token expired" });
  const user = await findById(rec.user_id);
  if (!user) return res.status(400).json({ error: "invalid_grant", error_description: "user no longer exists" });
  const nextRefresh = rand(48);
  await storeRefresh(nextRefresh, rec.user_id, rec.client_id, rec.scope);
  const accessToken = await issueAccessToken(rec.user_id, rec.scope);
  return res.json({ access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: nextRefresh, scope: rec.scope });
}
