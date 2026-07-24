# Store submission guide

Your connector is a live, multi-tenant, paid SaaS. This is the checklist +
step-by-step for listing it in the **Claude Connectors Directory** and the
**ChatGPT app store**. The final submit/review happens on Anthropic's and
OpenAI's platforms — this doc gets you fully ready and tells you exactly what to
click.

Live URLs (custom domain — live + SSL verified):
- Site / privacy / terms: `https://getcallme.app` · `/privacy` · `/terms`
- Connector (MCP): `https://getcallme.app/mcp`
- (`https://call-me-connector.onrender.com` still resolves as a fallback.)

## ✅ Readiness checklist (all done in code)
- [x] Remote MCP server over **HTTPS**
- [x] **OAuth 2.1 + PKCE** with Dynamic Client Registration + discovery metadata
- [x] **Privacy policy** and **Terms** at public URLs
- [x] **Tool annotations** (`readOnlyHint` / `destructiveHint` etc.) — required by Claude
- [x] Verb-based, human-readable tool names (`call_me`, `get_call_result`) with clear descriptions
- [x] You **own** the domain and service (no wrapping someone else's API)
- [x] Support contact (`SUPPORT_EMAIL`)
- [x] App **favicon/icon** at `/favicon.svg`

## Before you submit (both stores)
1. **Create a reviewer demo account** on your own site so reviewers can try it:
   a verified test number they can be called on, and (since calls are gated) a
   subscription — or temporarily relax the paywall for review.
2. **Prepare listing assets:** a 512×512 PNG icon (the `/favicon.svg` gradient +
   📞 is a starting point), 2–3 screenshots, and the copy below.

### Ready-to-paste listing copy
- **Name:** Call Me
- **Short description:** Your AI assistant calls your phone when a task is done or it's stuck — hear the update, say what's next, keep moving.
- **Long description:** Call Me lets Claude/ChatGPT phone your verified number with spoken updates and take your voice instructions back. Built for people on the go — founders, execs, consultants, sales — who need work to keep moving when they're away from the keyboard. Basic $6/mo, Pro $9/mo (full back-and-forth conversation).
- **Category:** Productivity / Communication
- **Tools:** `call_me` (calls you with an update + captures your reply), `get_call_result` (fetch a call's transcript).

---

## 1) Claude Connectors Directory
Docs: <https://claude.com/docs/connectors/building/submission> · FAQ: <https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq>

1. First, **add it as a custom connector** to confirm it works: claude.ai → Settings → Connectors → Add custom connector → `https://getcallme.app/mcp`. Approve the OAuth consent (sign up + verify your number).
2. Go to the **submission page** (docs link above) and submit the remote MCP URL, your privacy policy URL (`/privacy`), support contact, category, icon, and description.
3. Provide the **reviewer demo account** credentials.
4. Track status + reviewer feedback in the **submissions dashboard**. Reviews are manual; a missing/incomplete privacy policy is an instant reject (yours is complete).

## 2) ChatGPT app store (Apps SDK)
Docs: <https://developers.openai.com/apps-sdk/app-submission-guidelines> · Submission: <https://developers.openai.com/apps-sdk/deploy/submission>

1. Turn on **Developer mode** in ChatGPT and add your MCP server (`/mcp`) to test it on **web and mobile** — all tool test cases must pass on both.
2. **Verify your domain:** OpenAI gives you a token to serve as plain text. Set two env vars in Render and redeploy — the route is already built:
   - `OPENAI_VERIFICATION_PATH` = the path OpenAI specifies (e.g. `/.well-known/openai-domain-verification.txt`)
   - `OPENAI_VERIFICATION_TOKEN` = the token they give you
   Then confirm it serves at `https://getcallme.app/<that path>`.
3. Submit through the **plugin submission portal** with MCP connectivity details, testing guidelines, directory metadata, and country availability.

---

## Notes / nice-to-haves before going big
- [x] **Custom domain** — `getcallme.app` is live with SSL and is now `PUBLIC_URL`.
- **Always-on hosting:** upgrade the Render web service off the free (spins-down) plan so reviewer/customer calls aren't delayed ~50s on cold start.
- [x] **Merge `multi-tenant` → `main`** — done; `main` is canonical.
- Both stores scrutinize a tool that **places phone calls** — be ready to explain that it only ever calls the user's own verified number and is subscription-gated (both true).
