# Store submission checklist

The code in this repo is a working MCP connector. Both stores accept the same
remote MCP server; the gap between "works privately" and "listed in the store" is
mostly **auth + policy paperwork**, not code.

## Shared requirements (both stores)

- [ ] Deployed at a stable public HTTPS URL, `/mcp` reachable.
- [x] **OAuth 2.1** instead of a static bearer token. ✅ **Built in** — set
      `OAUTH_SIGNING_SECRET` + `OWNER_ACCESS_CODE` and it turns on (discovery,
      dynamic client registration, PKCE authorize + consent screen, token +
      refresh, protected-resource metadata). See README §4b. For a multi-user
      product you may prefer to front it with a hosted IdP (Auth0, WorkOS,
      Clerk, Stytch) and per-user accounts instead of a single owner code.
- [ ] Privacy policy URL. Be explicit that the connector places phone calls to a
      user-provided number and processes the spoken reply (STT) via Twilio.
- [ ] Support contact.
- [ ] Clear tool descriptions (already written) and an icon/name.
- [ ] Rate limiting + abuse protection, since a call tool has real-world cost.
      Keep `ALLOW_NUMBER_OVERRIDE=false`, or gate overrides behind per-user
      verified numbers.

## Claude connector directory

- Anthropic reviews submissions; you provide the remote MCP URL, OAuth details,
  logo, description, and privacy policy.
- Test first as a **custom connector** (README §5) to confirm the tools work in
  Claude before submitting for the directory.
- Expect review of what the tools *do* — a tool that dials a phone will get
  scrutiny on how the destination number is authorized and how you prevent abuse.

## ChatGPT (OpenAI) app / connector

- Built on the **Apps SDK**, which is MCP under the hood — this server is
  compatible as-is.
- Test first via **Settings → Connectors → Advanced → custom MCP connector**.
- For a public store listing, follow OpenAI's app submission flow: OAuth,
  metadata, privacy policy, and their content/safety review.

## Practical order of operations

1. Ship it and use it privately on both platforms with `CONNECTOR_TOKEN`.
2. Add OAuth.
3. Add privacy policy + support page + per-user number verification.
4. Submit to each store.
