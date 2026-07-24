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

## 0) Launch NOW via direct link (no store, no plan upgrade) — recommended first
The product is fully sellable today without any directory. Anyone can add the
connector themselves and pay:
1. Point people to **`https://getcallme.app`** (the landing page shows the URL + 3 steps).
2. They add **`https://getcallme.app/mcp`** as a custom connector in Claude or ChatGPT,
   sign up, and verify their phone.
3. First `call_me` hits the paywall message, which links them to
   `https://getcallme.app/account` to subscribe (Basic $6 / Pro $9) via Stripe (LIVE).
4. Calls start working. Done — real revenue, no gatekeeper.

The store listings below are a **discovery** channel on top of this, not a prerequisite.

## 1) Claude Connectors Directory — ⛔ needs a Team/Enterprise plan
Docs: <https://claude.com/docs/connectors/building/submission> · FAQ: <https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq>

**Blocked on plan tier.** The submission portal lives in claude.ai **Admin settings**,
which only exists on **Team or Enterprise** orgs (and only Owners can use it).
George's account is **Max (individual)** — no Admin settings, so there is nowhere to
submit. To pursue this listing you'd start a **Claude Team** org (~$30/user/mo) and
submit as its Owner. Everything else is ready; only the plan tier blocks it.

When/if on Team, the portal is an 11-step flow: Introduction → Connection (URL
`https://getcallme.app/mcp`, streamable HTTP) → Tools (auto-synced) → Listing (name,
tagline ≤55 char, description ≤2000, category, docs/privacy/support URLs, icon, slug)
→ Use cases → Company → Authentication (OAuth + DCR) → Data handling (your own API) →
Test & launch (reviewer creds below) → Compliance (7 attestations) → Review.

## 2) ChatGPT / OpenAI Apps SDK — ✅ open to individual developers
Docs: <https://developers.openai.com/apps-sdk/deploy/submission>

**No paid-plan gate.** You need a (free) OpenAI **Platform** account; as the org owner
you automatically have the required **Apps Management** write permission.

**Steps:**
1. **Verify identity** in OpenAI Platform → org settings → *individual* (own name) or
   *business* (your LLC) verification. Required for every public submission.
2. **Test first (developer mode):** in ChatGPT settings enable developer/Apps mode, add
   `https://getcallme.app/mcp`, and run the test cases below on web + mobile.
3. **Domain verification:** the portal shows a token to host at
   `https://getcallme.app/.well-known/openai-apps-challenge` returning **only** that token
   as plain text. The route is already built — set two Render env vars and redeploy:
   - `OPENAI_VERIFICATION_PATH` = `/.well-known/openai-apps-challenge`
   - `OPENAI_VERIFICATION_TOKEN` = the token from the portal
   (Ping me and I'll set these in Render the moment you have the token.)
4. **Open the portal** → Create plugin → *With MCP* → fill listing, select verified
   identity, enter MCP URL, **Scan Tools**, add reviewer creds, prompts, test cases,
   countries, release notes → attestations → **Submit for Review**.
5. After approval, **you** publish from the portal; it then appears in the Plugins
   Directory (shared by ChatGPT + Codex).

**Reviewer demo credentials (works without SMS — required by OpenAI):**
> Email `georgevogeljr10+reviewer@gmail.com`, password `CallMe-Review-2026`.
> On the sign-in screen tap **Create account** (or Sign in if it exists). Enter **your
> own phone number** — no SMS code is required for this account, it's trusted instantly —
> then ask the assistant to call you. (This allowlisted account also skips the paywall.)

**Starter prompts:**
- "When this task finishes, call me with a summary and ask what to prioritize next."
- "I'm heading out — if you get blocked, call my phone and read me the blocker."
- "Call me, read these three questions aloud, and capture my spoken answers."

**5 positive test cases** (each: user prompt → expected):
1. "Call me and tell me the deploy is done, then ask if I want smoke tests run." → `call_me` places a call to the reviewer's verified number; TTS reads the summary + question; returns a `call_id`.
2. "When the report's ready, call me with a summary and take my next instruction." → `call_me` with a summary; captures the spoken reply; `get_call_result` returns the transcript.
3. "Phone me and read these three questions, then read back what I say." → `call_me` with a questions list; captures reply.
4. "Start the call in conversation mode so we can go back and forth." → `call_me` conversational mode (Pro); multi-turn capture until the user says done.
5. "You called me a minute ago — fetch what I said." → `get_call_result` with the `call_id` returns status + transcript.

**3 negative test cases:**
1. "Call my coworker at (312) 555-0148 and read him this." → connector **only** rings the account's own verified number; it does not dial arbitrary third-party numbers. Expected: it calls the user's own number (or explains it can only call the verified account number).
2. `call_me` from an account with no verified phone or no subscription → safe error telling the user to verify their number / subscribe at `/account`; **no call is placed**.
3. "Call this premium number 50 times in a row." → fair-use monthly cap (Basic 100 / Pro 500) blocks abuse; there is no bulk/again loop and no delete tool. Expected: declines past the cap.

**Release notes (initial submission):** Call Me is an MCP connector that phones the
user's own verified number with a spoken update (TTS) and captures their spoken reply
(STT) to keep a task moving. OAuth 2.1 + PKCE with dynamic client registration. Two
tools: `call_me` (write — places a call) and `get_call_result` (read). No custom UI, so
no CSP needed. Reviewer demo account bypasses SMS verification and the paywall so the
core flow is testable without a code.

---

## Notes / nice-to-haves before going big
- [x] **Custom domain** — `getcallme.app` is live with SSL and is now `PUBLIC_URL`.
- [x] **Reviewer flow** — `REVIEWER_EMAILS` allowlist skips both the paywall **and** SMS verification, so reviewers test with zero friction.
- **Always-on hosting:** upgrade the Render web service off the free (spins-down) plan so reviewer/customer calls aren't delayed ~50s on cold start. Worth doing before either store review.
- [x] **Merge `multi-tenant` → `main`** — done; `main` is canonical.
- Both stores scrutinize a tool that **places phone calls** — be ready to explain that it only ever calls the user's own verified number and is subscription-gated (both true).
