function isTrue(v: string | undefined, def: boolean): boolean {
  if (v == null || v === "") return def;
  return /^(1|true|yes|on)$/i.test(v);
}

const oauthConfigured = !!(process.env.OAUTH_SIGNING_SECRET && process.env.OWNER_ACCESS_CODE);
const tier = (process.env.TIER ?? "basic").toLowerCase() === "pro" ? "pro" : "basic";

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  // Normalize away a trailing slash so we can safely concatenate paths.
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
  },

  userPhoneNumber: process.env.USER_PHONE_NUMBER ?? "",
  allowNumberOverride: isTrue(process.env.ALLOW_NUMBER_OVERRIDE, false),

  // Legacy / personal-use static bearer token for /mcp. Still honored even when
  // OAuth is on, so you don't have to re-auth your own private setup.
  connectorToken: process.env.CONNECTOR_TOKEN ?? "",
  validateTwilioSignature: isTrue(process.env.VALIDATE_TWILIO_SIGNATURE, true),

  // OAuth 2.1 (required for a public store listing). Auto-enables once a signing
  // secret + owner access code are present; set OAUTH_ENABLED to force either way.
  oauth: {
    enabled: isTrue(process.env.OAUTH_ENABLED, oauthConfigured),
    signingSecret: process.env.OAUTH_SIGNING_SECRET ?? "",
    ownerAccessCode: process.env.OWNER_ACCESS_CODE ?? "",
  },

  // "basic" = one-shot calls only. "pro" = unlocks multi-turn conversation mode.
  tier: tier as "basic" | "pro",

  voice: process.env.VOICE ?? "Polly.Joanna",
  language: process.env.LANGUAGE ?? "en-US",

  // Seconds of silence to wait before ending speech capture. "auto" uses
  // Twilio's smart endpointing (ends fast on any pause — cuts people off).
  // A number (e.g. "5") waits that many seconds of silence, so a breath or a
  // mid-thought pause won't hang up on you. Default 10.
  speechTimeout: process.env.SPEECH_TIMEOUT ?? "10",
};

/**
 * Throws a clear, actionable error if the settings required to actually place a
 * call are missing. Called lazily (at call time) so the server can still boot
 * for health checks / store validation without full Twilio config.
 */
export function assertCallConfig(): void {
  const missing: string[] = [];
  if (!config.publicUrl) missing.push("PUBLIC_URL");
  if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  if (!config.userPhoneNumber) missing.push("USER_PHONE_NUMBER");
  if (missing.length) {
    throw new Error(
      `Cannot place a call — missing environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill these in (see README).`
    );
  }
}
