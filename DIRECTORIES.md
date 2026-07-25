# Where to list Call Me (directory / "store" checklist)

**Reality check first:** Call Me is an MCP connector, not a mobile app — so **Google Play
and the Apple App Store don't apply** (nothing to install on a phone). Directories below
are the real "store" equivalents. They give **passive discovery + SEO backlinks**, not a
traction spike. Product Hunt / Show HN are the only real "launch moments." The demo video
+ active posting still does the heavy lifting. Do the free ones; don't wait on them.

Connector URL: `https://getcallme.app/mcp` · Site: `https://getcallme.app` ·
Install page: `https://getcallme.app/connect`

---

## Tier 1 — free, highest leverage (do first)

### 1. Official MCP Registry ⭐ keystone
`registry.modelcontextprotocol.io` — the canonical index. **Accepts REMOTE servers**
(a `remotes` entry with a streamable-http URL) and proves ownership via a **DNS or HTTP
domain challenge** — so we can claim a `getcallme.app` namespace **without a public code
repo**. No human review queue; free.
- Process: write a `server.json`, install the `mcp-publisher` CLI, authenticate with the
  domain challenge (DNS TXT on Cloudflare, or an HTTP token served at getcallme.app), then
  `publish`.
- **Why it matters:** PulseMCP (and other aggregators) **ingest the official registry
  automatically**, so this one publish propagates to several directories.
- *Claude can do most of this for you — see "Next action" below.*

### 2. mcp.so
Largest aggregator (~20k servers). Submit via the **Submit** button on mcp.so or a GitHub
issue. Free.

### 3. Glama — `glama.ai/mcp`
Auto-crawls the ecosystem; you **claim + verify ownership** of your listing. Free. (Leans
toward GitHub/open-source indexing — the claim flow is the path for a hosted server.)

### 4. Smithery — `smithery.ai`
`smithery mcp publish <url> -n getcallme/call-me` via their CLI, or the web dashboard. Free.

### 5. Product Hunt — the one real "launch moment"
Free. Launch with the demo video + `getcallme.app/connect`. Biggest single-day visibility.
Pick a Tues–Thurs, reply to every comment all day.

---

## Tier 2 — free, SEO / long-tail discovery

- **PulseMCP** (`pulsemcp.com`) — ingests the Official Registry daily, so publishing to #1
  gets you here automatically; email `hello@pulsemcp.com` to tweak the listing.
- **Awesome MCP Servers** (`github.com/punkpeye/awesome-mcp-servers`) — open a PR to add
  Call Me. Free. (Best if the repo is public.)
- **mcp.directory** — auto-pulls metadata; publishes within ~24h.
- **There's An AI For That** (`theresanaiforthat.com`) — huge AI-shopper traffic. Free
  submission sits in a **review queue** (weeks); paid fast-track exists.
- **Toolify** (`toolify.ai`) — free submission with a multi-week queue, or **$99** one-time
  fast-track (listed in 48h, dofollow backlink).
- **Show HN** (Hacker News) — free, technical audience; post the honest build story.

---

## Tier 3 — paid, optional, only once you see conversion
- Toolify $99 fast-track · There's An AI For That paid tier · Futurepedia (now paid up front).
  Skip until you know a listing actually converts for you.

---

## What to have ready (same metadata everywhere)
- **Name:** Call Me
- **One-liner:** Your AI calls your phone when a task is done or it's stuck — hear the
  update, say what's next, keep moving.
- **Category:** Productivity / Communication / Voice
- **URLs:** site `getcallme.app`, connector `getcallme.app/mcp`, privacy `/privacy`,
  terms `/terms`, support `getcallmenow@gmail.com`
- **Icon:** `assets/icon-512.png` · **Demo video:** `assets/callme-demo-sound.mp4`
- **Tools:** `call_me`, `get_call_result` (with annotations)
- **Transport:** Streamable HTTP · **Auth:** OAuth 2.1 + PKCE

## Open question for you
Some GitHub-based lists (Awesome MCP Servers, parts of Glama/mcp.directory) work best if the
**code repo is public**. Ours is private but holds **no secrets** (those live in Render env).
Open-sourcing it would unlock those lists and build developer trust — your call. Not required
for Tier 1.

---
Sources: Truefoundry, RoxyAPI, DYNO Mapper, Tallyfy, PulseMCP, Glama, Toolify submission
guides (researched 2026-07).
