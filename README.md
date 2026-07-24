# Call Me — a phone-a-human MCP connector

An MCP connector that lets an AI assistant **call your cell phone** when a task is
done or blocked. On the call it reads out — via text-to-speech — a summary of what
happened, what's next, and any questions. Then it **listens to your spoken reply**
(speech-to-text) and hands your instructions back to the model to act on.

It's a single remote MCP server (Streamable HTTP), so the same deployment works
as a **Claude connector** and as a **ChatGPT connector**. Telephony is handled by
**Twilio Programmable Voice**.

```
Assistant ──call_me(summary, questions, next_steps)──▶ this server ──▶ Twilio ──▶ ☎ your phone
                                                                                     │ you speak
Assistant ◀──── "the user said: …" ◀──── transcript ◀──── /voice/collect ◀──────────┘
```

## Tools it exposes

| Tool | What it does |
|------|--------------|
| `call_me` | Places the call, speaks `summary` → `next_steps` → `questions`, captures your spoken reply, and returns it as text. Waits for the reply by default. |
| `get_call_result` | Fetches the reply for a `call_id` if the call outlived the request window (or you used `wait_for_reply: false`). |

## Plans

| | **Basic** | **Pro** |
|--|--|--|
| One-shot call (read update, capture one reply) | ✅ | ✅ |
| Multi-turn **conversation** mode (`conversational: true` — keeps listening until you say "done") | — | ✅ |
| Suggested price | ~$5/mo | ~$15/mo |

Set the tier with the `TIER` env var (`basic` or `pro`). On Basic, a
`conversational: true` call is rejected with an upgrade message. Pro costs more
because conversational calls run longer (more Twilio voice minutes) and issue
more speech-recognition requests per call. There's no billing built in — `TIER`
is the switch a billing system would flip; wire it to Stripe when you productize.

## Safety model

- **Locked to one number.** By default the server only ever dials `USER_PHONE_NUMBER`. Any `to` the model passes is ignored unless you set `ALLOW_NUMBER_OVERRIDE=true`. This is what stops the connector from being turned into a robo-dialer.
- **Signed webhooks.** Twilio requests are verified against your auth token (`VALIDATE_TWILIO_SIGNATURE=true`).
- **Auth, two ways.** Either a static `CONNECTOR_TOKEN` (simple, private use) or full **OAuth 2.1** (required for a public store listing — see below). Both can be on at once.

---

## 1. Prerequisites

- Node.js 20+
- A Twilio account with:
  - Account SID + Auth Token (Console dashboard)
  - A voice-capable Twilio phone number (`TWILIO_FROM_NUMBER`)
- Somewhere to host a small public HTTPS service (Render / Fly.io / Railway).
  Twilio must be able to reach it, so localhost only works via a tunnel (see below).

## 2. Configure

```bash
cp .env.example .env
# then edit .env — Twilio creds, your Twilio number, and YOUR cell number
```

## 3. Run locally (with a tunnel)

```bash
npm install
npm run dev
```

In another terminal expose it so Twilio can call back:

```bash
npx localtunnel --port 3000     # or: ngrok http 3000
```

Set `PUBLIC_URL` in `.env` to the HTTPS URL the tunnel prints, then restart.

## 4. Deploy (Render example)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo (`render.yaml` is included).
3. After the first deploy, copy the service URL (e.g. `https://call-me-connector.onrender.com`)
   into the `PUBLIC_URL` env var, and fill in the Twilio + phone secrets. Redeploy.
4. Health check: open `PUBLIC_URL/` — you should get a small JSON status blob.

Your MCP connector URL is: **`PUBLIC_URL/mcp`**

## 4b. Turn on OAuth 2.1 (for store submission)

Static tokens are fine for private use, but a **public store listing requires
OAuth**. This server has a built-in OAuth 2.1 provider — no external IdP needed.
Enable it by setting two env vars:

```bash
# a long random signing secret:
OAUTH_SIGNING_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
# the code you'll type on the consent screen to approve a connection:
OWNER_ACCESS_CODE=pick-something-only-you-know
```

Once both are set, OAuth auto-enables and `/mcp` requires a valid OAuth token.
The flow is standard and both Claude and ChatGPT drive it automatically:

- Discovery: `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- Dynamic client registration: `POST /oauth/register`
- Authorize (PKCE S256) with a consent screen: `GET/POST /oauth/authorize`
- Token + refresh: `POST /oauth/token`

When you add the connector, the client pops open the consent page — enter your
`OWNER_ACCESS_CODE` to approve. Access tokens are signed JWTs (1h) with rotating
refresh tokens (30d).

> In-memory state: registered clients, auth codes, and refresh tokens live in
> process memory — perfect for a single personal instance. If you scale to
> multiple instances, back them (and the call store) with Redis.

> Note on request timeouts: `call_me` holds the request open while it waits for
> you to answer (default up to 150s). Most hosts allow this; if your host caps
> request duration lower, either lower `timeout_seconds` or use
> `wait_for_reply: false` + `get_call_result`.

---

## 5. Add it to Claude

**Quick / personal use (Claude Desktop or claude.ai → Settings → Connectors):**

1. **Add custom connector**.
2. URL: `https://your-deployment/mcp`
3. If you set `CONNECTOR_TOKEN`, add header `Authorization: Bearer <token>`.
4. Enable it, then tell Claude e.g. *"When you finish, call me and read out your questions."*

**Listing in the Claude connector directory:** submit the same remote MCP URL via
Anthropic's connector submission process. Directory listings generally expect
OAuth rather than a static bearer token and a privacy policy / support contact —
see `STORE-SUBMISSION.md` for the checklist and where OAuth would slot in.

## 6. Add it to ChatGPT

ChatGPT consumes the **same MCP server**.

- **Developer mode / custom connector:** Settings → Connectors → Advanced →
  add `https://your-deployment/mcp` as a custom MCP connector.
- **Publishing an app in the ChatGPT store** uses the Apps SDK, which is also MCP
  based. The tools here work as-is; store review adds requirements (OAuth,
  privacy policy, metadata). See `STORE-SUBMISSION.md`.

---

## Project layout

```
src/
  config.ts   env config + "can we place a call?" assertion
  store.ts    in-memory call state + wait-for-reply + conversation turns
  twilio.ts   places the outbound call
  twiml.ts    the spoken script + speech <Gather> (one-shot + conversational)
  mcp.ts      the MCP server, the two tools, and the Pro-tier gate
  oauth.ts    built-in OAuth 2.1 provider (discovery, DCR, PKCE, tokens)
  server.ts   Express: /mcp + Twilio webhooks + OAuth routes + auth
```

## Cost

Roughly Twilio's per-minute voice rate (~1¢/min in the US) plus ~$1/mo for the
number, plus a few tenths of a cent per speech-recognition request. A typical
call is well under 5¢.

## Conversation mode (Pro)

On the Pro tier, pass `conversational: true` to `call_me`. Instead of hanging up
after one reply, `/voice/collect` loops — acknowledging each utterance and
gathering the next — accumulating everything you say until you say "done" (or a
similar stop phrase), stay silent, or hit the 8-turn cap. All turns are joined
and returned to the model as one transcript.

This is a "scripted loop" conversation — the model isn't live on the call. For a
truly LLM-driven phone agent (it reasons and responds mid-call), swap Twilio for
a managed voice-agent platform (Vapi, Bland, Retell); the MCP tool surface can
stay the same.
