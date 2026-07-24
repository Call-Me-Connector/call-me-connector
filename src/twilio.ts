import twilio from "twilio";
import { config, assertCallConfig } from "./config.js";
import { store, type CallRecord } from "./store.js";

let client: twilio.Twilio | null = null;

function getClient(): twilio.Twilio {
  if (!client) {
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
}

/**
 * Place the outbound call. Twilio will fetch TwiML from our /voice/outbound
 * endpoint when the callee picks up, and post lifecycle events to /voice/status.
 */
export async function placeCall(rec: CallRecord): Promise<void> {
  assertCallConfig();

  const outboundUrl = `${config.publicUrl}/voice/outbound?callId=${encodeURIComponent(rec.id)}`;
  const statusUrl = `${config.publicUrl}/voice/status?callId=${encodeURIComponent(rec.id)}`;

  const call = await getClient().calls.create({
    to: rec.to,
    from: config.twilio.fromNumber,
    url: outboundUrl,
    method: "POST",
    statusCallback: statusUrl,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    // Give up if it rings out — avoids a wait that never resolves.
    timeout: 30,
  });

  store.update(rec.id, { twilioSid: call.sid, status: "queued" });
}
