import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";

/**
 * A minimal but spec-compliant OAuth 2.1 authorization server, enough for the
 * Claude and ChatGPT connector flows: RFC 9728 protected-resource metadata,
 * RFC 8414 AS metadata, RFC 7591 dynamic client registration, and the
 * authorization-code + PKCE (S256) + refresh-token grants.
 *
 * The owner authenticates on the consent screen with OWNER_ACCESS_CODE. Access
 * tokens are stateless HS256 JWTs; auth codes, refresh tokens, and registered
 * clients live in memory (fine for a single personal instance — use Redis if
 * you run more than one).
 */

const SCOPE = "call:me";
const ACCESS_TTL_S = 3600; // 1 hour
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const enc = new TextEncoder();
const key = () => enc.encode(config.oauth.signingSecret);
const audience = () => `${config.publicUrl}/mcp`;
const rand = (n = 32) => randomBytes(n).toString("base64url");

interface Client {
  clientId: string;
  redirectUris: string[];
  name?: string;
  createdAt: number;
}
interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}
interface Refresh {
  clientId: string;
  scope: string;
  expiresAt: number;
}

const clients = new Map<string, Client>();
const authCodes = new Map<string, AuthCode>();
const refreshTokens = new Map<string, Refresh>();

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function issueAccessToken(scope: string): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject("owner")
    .setIssuer(config.publicUrl)
    .setAudience(audience())
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(key());
}

/** Resource-server check used by the /mcp handler. */
export async function verifyAccessToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, key(), {
      issuer: config.publicUrl,
      audience: audience(),
    });
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function consentPage(params: Record<string, string>, error?: string): string {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n      ");
  const clientName = clients.get(params.client_id ?? "")?.name || "An AI assistant";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize — Call Me connector</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; } .sub { opacity: .75; }
  form { margin-top: 1.5rem; display: grid; gap: .75rem; }
  input[type=password] { padding: .6rem; font-size: 1rem; border-radius: .5rem; border: 1px solid #8888; }
  button { padding: .7rem; font-size: 1rem; border: 0; border-radius: .5rem; background: #4f46e5; color: #fff; cursor: pointer; }
  .err { color: #dc2626; margin-top: 1rem; }
  code { background: #8882; padding: .1rem .3rem; border-radius: .3rem; }
</style></head>
<body>
  <h1>Authorize access</h1>
  <p class="sub"><strong>${escapeHtml(clientName)}</strong> wants permission to call your phone with task updates and read back your spoken replies.</p>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
  <form method="POST" action="/oauth/authorize">
      ${hidden}
      <label>Owner access code<br><input type="password" name="access_code" autocomplete="current-password" autofocus required></label>
      <button type="submit">Approve</button>
  </form>
  <p class="sub" style="margin-top:2rem;font-size:.85rem">Scope requested: <code>${SCOPE}</code></p>
</body></html>`;
}

function cors(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
}

export function buildOAuthRouter(): Router {
  const router = Router();
  const json = express.json();
  const form = express.urlencoded({ extended: false });

  router.use(cors);
  router.options("*", (_req, res) => res.sendStatus(204));

  // --- RFC 9728: protected resource metadata -------------------------------
  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: audience(),
      authorization_servers: [config.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
  });
  // Some clients probe the path-suffixed variant for the /mcp resource.
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json({
      resource: audience(),
      authorization_servers: [config.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
  });

  // --- RFC 8414: authorization server metadata -----------------------------
  const asMetadata = () => ({
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
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(asMetadata()));
  // OpenID-style discovery path, harmless to also serve.
  router.get("/.well-known/openid-configuration", (_req, res) => res.json(asMetadata()));

  // --- RFC 7591: dynamic client registration -------------------------------
  router.post("/oauth/register", json, (req, res) => {
    const body = req.body ?? {};
    const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string" && /^https?:\/\//.test(u))) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be a non-empty array of absolute http(s) URLs.",
      });
    }
    const client: Client = {
      clientId: `client_${rand(16)}`,
      redirectUris,
      name: typeof body.client_name === "string" ? body.client_name : undefined,
      createdAt: Date.now(),
    };
    clients.set(client.clientId, client);
    res.status(201).json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: client.name,
      scope: SCOPE,
    });
  });

  // --- Authorization endpoint (consent screen) -----------------------------
  router.get("/oauth/authorize", (req, res) => {
    const q = req.query as Record<string, string>;
    const err = validateAuthRequest(q);
    if (err) return res.status(400).type("text/plain").send(`invalid_request: ${err}`);
    res.type("text/html").send(
      consentPage({
        client_id: q.client_id,
        redirect_uri: q.redirect_uri,
        state: q.state ?? "",
        code_challenge: q.code_challenge,
        code_challenge_method: q.code_challenge_method,
        scope: q.scope ?? SCOPE,
      })
    );
  });

  router.post("/oauth/authorize", form, (req, res) => {
    const b = req.body as Record<string, string>;
    const err = validateAuthRequest(b);
    if (err) return res.status(400).type("text/plain").send(`invalid_request: ${err}`);

    const ok =
      config.oauth.ownerAccessCode.length > 0 &&
      constantTimeEqual(b.access_code ?? "", config.oauth.ownerAccessCode);
    if (!ok) {
      return res.status(401).type("text/html").send(
        consentPage(
          {
            client_id: b.client_id,
            redirect_uri: b.redirect_uri,
            state: b.state ?? "",
            code_challenge: b.code_challenge,
            code_challenge_method: b.code_challenge_method,
            scope: b.scope ?? SCOPE,
          },
          "Incorrect access code. Try again."
        )
      );
    }

    const code = rand(32);
    authCodes.set(code, {
      clientId: b.client_id,
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      scope: b.scope || SCOPE,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const redirect = new URL(b.redirect_uri);
    redirect.searchParams.set("code", code);
    if (b.state) redirect.searchParams.set("state", b.state);
    res.redirect(302, redirect.toString());
  });

  // --- Token endpoint ------------------------------------------------------
  router.post("/oauth/token", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    try {
      if (b.grant_type === "authorization_code") {
        return await handleAuthCodeGrant(b, res);
      }
      if (b.grant_type === "refresh_token") {
        return await handleRefreshGrant(b, res);
      }
      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch (e) {
      console.error("[oauth] token error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

function validateAuthRequest(q: Record<string, string>): string | null {
  if (q.response_type !== "code") return "response_type must be 'code'";
  const client = clients.get(q.client_id ?? "");
  if (!client) return "unknown client_id";
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri))
    return "redirect_uri not registered for this client";
  if (!q.code_challenge) return "code_challenge is required (PKCE)";
  if (q.code_challenge_method !== "S256") return "code_challenge_method must be 'S256'";
  return null;
}

async function handleAuthCodeGrant(b: Record<string, string>, res: Response) {
  const record = authCodes.get(b.code ?? "");
  if (!record) return res.status(400).json({ error: "invalid_grant", error_description: "unknown or used code" });
  authCodes.delete(b.code); // one-time use
  if (Date.now() > record.expiresAt)
    return res.status(400).json({ error: "invalid_grant", error_description: "code expired" });
  if (b.client_id !== record.clientId)
    return res.status(400).json({ error: "invalid_grant", error_description: "client mismatch" });
  if (b.redirect_uri !== record.redirectUri)
    return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });

  // PKCE: base64url(sha256(code_verifier)) must equal the stored challenge.
  const verifier = b.code_verifier ?? "";
  const computed = createHash("sha256").update(verifier).digest("base64url");
  if (!verifier || computed !== record.codeChallenge)
    return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });

  const accessToken = await issueAccessToken(record.scope);
  const refresh = rand(48);
  refreshTokens.set(refresh, {
    clientId: record.clientId,
    scope: record.scope,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });
  return res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: record.scope,
  });
}

async function handleRefreshGrant(b: Record<string, string>, res: Response) {
  const record = refreshTokens.get(b.refresh_token ?? "");
  if (!record) return res.status(400).json({ error: "invalid_grant", error_description: "unknown refresh_token" });
  if (Date.now() > record.expiresAt) {
    refreshTokens.delete(b.refresh_token);
    return res.status(400).json({ error: "invalid_grant", error_description: "refresh_token expired" });
  }
  if (b.client_id && b.client_id !== record.clientId)
    return res.status(400).json({ error: "invalid_grant", error_description: "client mismatch" });

  // Rotate the refresh token.
  refreshTokens.delete(b.refresh_token);
  const nextRefresh = rand(48);
  refreshTokens.set(nextRefresh, {
    clientId: record.clientId,
    scope: record.scope,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });
  const accessToken = await issueAccessToken(record.scope);
  return res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: nextRefresh,
    scope: record.scope,
  });
}
