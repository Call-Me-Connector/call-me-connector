# Official MCP Registry listing

Published as **`app.getcallme/call-me`** (domain-verified via `getcallme.app`).
Verify: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=getcallme"`

## How it's authenticated
Domain (HTTP) ownership: the site serves the ed25519 public key at
`/.well-known/mcp-registry-auth` (route in `src/site.ts`). The matching **private key
is NOT stored in this repo** — it lived only in a local scratch dir for the publish.

## To publish an updated version
1. Bump `version` in `registry/server.json`.
2. Get the `mcp-publisher` CLI (github.com/modelcontextprotocol/registry releases).
3. Re-authenticate. Either reuse the saved private key, or generate a fresh keypair and
   update the public key in the `/.well-known/mcp-registry-auth` route, then:
   `mcp-publisher login http --domain getcallme.app --private-key <hex>`
4. From this folder: `mcp-publisher validate && mcp-publisher publish`

Downstream directories (PulseMCP, etc.) ingest the official registry automatically.
