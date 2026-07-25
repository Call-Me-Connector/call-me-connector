import twilio from "twilio";
import { config } from "./config.js";
import type { CallRecord } from "./store.js";

/**
 * Outbound SMS. Used for the Pro "text me the summary if I don't pick up" fallback
 * and to prompt for a texted reply. Requires Twilio A2P 10DLC registration to reach
 * US numbers reliably — gate all calls on config.smsEnabled.
 */

let client: twilio.Twilio | null = null;
function getClient(): twilio.Twilio {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

/** Send an SMS, using the A2P Messaging Service when configured, else the From number. */
export async function sendSms(to: string, body: string): Promise<string> {
  const msg = await getClient().messages.create(
    config.messagingServiceSid
      ? { to, body, messagingServiceSid: config.messagingServiceSid }
      : { to, body, from: config.twilio.fromNumber }
  );
  return msg.sid;
}

/** Compose the "you didn't pick up" text from a call's summary, next steps, and questions. */
export function buildFallbackSms(rec: CallRecord): string {
  const parts: string[] = [rec.summary];
  if (rec.nextSteps) parts.push(`Next: ${rec.nextSteps}`);
  if (rec.questions.length) {
    parts.push(rec.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"));
  }
  parts.push("Reply to this text and I'll pass it back to your assistant.");
  // SMS segments are billed per ~153 chars; keep it reasonable.
  return parts.join("\n\n").slice(0, 1400);
}
