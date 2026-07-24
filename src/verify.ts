import twilio from "twilio";
import { config } from "./config.js";

/**
 * Phone-number verification via Twilio Verify. Verify is a managed OTP service:
 * it generates, sends, rate-limits, and checks the code for us — no A2P
 * registration needed for the codes themselves.
 *
 * Requires TWILIO_VERIFY_SERVICE_SID (create a Verify Service once, in the
 * Twilio console or via the API).
 */

let client: twilio.Twilio | null = null;
function getClient(): twilio.Twilio {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

function assertVerifyConfig(): void {
  if (!config.verifyServiceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID is not set — phone verification is unavailable.");
  }
}

/** E.164 sanity check. */
export function isE164(v: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(v);
}

/**
 * Forgiving phone normalization so users can type spaces, dashes, parens, or a
 * bare 10-digit US number. Returns a best-effort E.164 string (validate with
 * isE164 afterwards).
 *   "(219) 302-1613" -> "+12193021613"
 *   "219 302 1613"   -> "+12193021613"
 *   "+44 20 7946 0958" -> "+442079460958"
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) return "+" + digits;
  if (digits.length === 10) return "+1" + digits; // US/Canada 10-digit
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

/** Send a verification code to the number via SMS or voice call. */
export async function startVerification(e164: string): Promise<void> {
  assertVerifyConfig();
  await getClient()
    .verify.v2.services(config.verifyServiceSid)
    .verifications.create({ to: e164, channel: config.verifyChannel });
}

/** Check a code the user entered. Returns true if it matches and is still valid. */
export async function checkVerification(e164: string, code: string): Promise<boolean> {
  assertVerifyConfig();
  try {
    const result = await getClient()
      .verify.v2.services(config.verifyServiceSid)
      .verificationChecks.create({ to: e164, code });
    return result.status === "approved";
  } catch (err) {
    // Twilio throws 404 when the code has expired or was already consumed.
    if (err instanceof Error && /not found|404|20404/i.test(err.message)) return false;
    throw err;
  }
}
