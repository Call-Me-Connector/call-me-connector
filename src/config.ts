function isTrue(v: string | undefined, def: boolean): boolean {
  if (v == null || v === "") return def;
  return /^(1|true|yes|on)$/i.test(v);
}

const multiTenant = (process.env.DATABASE_URL ?? "").length > 0;
// Single-user OAuth needs an owner code; multi-tenant just needs a signing secret
// (each user logs in with their own account instead of a shared code).
const oauthConfigured = multiTenant
  ? !!process.env.OAUTH_SIGNING_SECRET
  : !!(process.env.OAUTH_SIGNING_SECRET && process.env.OWNER_ACCESS_CODE);
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
  // In multi-tenant mode this is the DEFAULT tier for new signups; each user's
  // own tier (from billing) overrides it.
  tier: tier as "basic" | "pro",

  // ---- Multi-tenant (SaaS) mode ----
  // When DATABASE_URL is set, the connector runs multi-tenant: users sign up,
  // verify their own phone number, and calls go to THEIR number (USER_PHONE_NUMBER
  // is ignored). Without it, the connector stays in single-user mode.
  databaseUrl: process.env.DATABASE_URL ?? "",
  multiTenant,
  // Twilio Verify service SID, used to send/check phone verification codes.
  verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? "",

  // ---- SMS (Pro): text the summary if the call isn't answered + capture texted replies ----
  // Sending SMS *content* from a US number requires Twilio A2P 10DLC registration.
  // Set TWILIO_MESSAGING_SERVICE_SID (the A2P-registered Messaging Service) to turn SMS
  // features ON. Until then they stay off and calls behave exactly as before.
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
  get smsEnabled(): boolean {
    return this.messagingServiceSid.length > 0 || isTrue(process.env.SMS_ENABLED, false);
  },

  // ---- Stripe billing ----
  // Billing only activates when STRIPE_SECRET_KEY is set. Until then every
  // verified user can call (no paywall), so nothing breaks before setup.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    priceBasic: process.env.STRIPE_PRICE_BASIC ?? "", // price_… for the $6/mo plan
    pricePro: process.env.STRIPE_PRICE_PRO ?? "", // price_… for the $9/mo plan
  },
  get billingEnabled() {
    return this.stripe.secretKey.length > 0;
  },

  // Monthly fair-use call caps per plan (protects margin from heavy usage).
  callCaps: {
    basic: parseInt(process.env.CAP_BASIC ?? "100", 10),
    pro: parseInt(process.env.CAP_PRO ?? "500", 10),
  },

  // Emails that skip the subscription paywall (for store reviewers to test).
  // Comma-separated. Fair-use caps still apply. e.g. "review@anthropic.com,review@openai.com"
  reviewerEmails: (process.env.REVIEWER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Channel for verification codes: "sms" or "call". Voice ("call") avoids the
  // A2P 10DLC registration that SMS from a 10-digit number requires.
  verifyChannel: (process.env.VERIFY_CHANNEL ?? "sms").toLowerCase() === "call" ? "call" : "sms",

  voice: process.env.VOICE ?? "Polly.Joanna-Neural",
  language: process.env.LANGUAGE ?? "en-US",

  // Public-facing contact + brand for the marketing site.
  supportEmail: process.env.SUPPORT_EMAIL ?? "getcallmenow@gmail.com",
  brandName: process.env.BRAND_NAME ?? "Call Me",

  // ChatGPT/OpenAI domain verification: at app submission OpenAI gives you a
  // token to serve as plain text at a path. Set both and it's served.
  openaiVerificationPath: process.env.OPENAI_VERIFICATION_PATH ?? "",
  openaiVerificationToken: process.env.OPENAI_VERIFICATION_TOKEN ?? "",

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
