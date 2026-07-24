import twilio from "twilio";
import type VoiceResponseTypes from "twilio/lib/twiml/VoiceResponse.js";
import { config } from "./config.js";
import type { CallRecord } from "./store.js";

const { VoiceResponse } = twilio.twiml;

// The configured voice/language are plain strings from env; Twilio's types want
// specific string-literal unions. We validate at the edge (env) and assert here.
type SayAttrs = VoiceResponseTypes.SayAttributes;
const say: SayAttrs = {
  voice: config.voice as SayAttrs["voice"],
  language: config.language as SayAttrs["language"],
};
const gatherLanguage = config.language as VoiceResponseTypes.GatherAttributes["language"];

/**
 * TwiML the phone plays when the call connects: read the update aloud, then open
 * a speech <Gather> to capture the user's spoken instructions.
 */
export function buildOutboundTwiml(rec: CallRecord, collectUrl: string): string {
  const vr = new VoiceResponse();

  vr.say(say, "Hi, this is Claude calling with an update on your task.");
  vr.say(say, rec.summary);

  if (rec.nextSteps && rec.nextSteps.trim()) {
    vr.say(say, "Here is what I am planning to do next.");
    vr.say(say, rec.nextSteps);
  }

  if (rec.questions.length) {
    const n = rec.questions.length;
    vr.say(say, `I have ${n} question${n === 1 ? "" : "s"} for you.`);
    rec.questions.forEach((q, i) => {
      vr.say(say, `Question ${i + 1}. ${q}`);
    });
  }

  const prompt = rec.conversational
    ? "After the beep, tell me how you would like me to proceed. You can keep talking; just say \"done\" when you are finished."
    : "After the beep, tell me how you would like me to proceed, then pause when you are done.";
  gatherSpeech(vr, collectUrl, prompt);
  return vr.toString();
}

/**
 * Conversational mode: acknowledge the last utterance and gather the next one.
 */
export function buildRepromptTwiml(collectUrl: string): string {
  const vr = new VoiceResponse();
  gatherSpeech(vr, collectUrl, "Got it. Anything else? Say \"done\" when you are finished.");
  // If they stay silent, treat it as finished.
  vr.redirect({ method: "POST" }, `${collectUrl}&silent=1`);
  return vr.toString();
}

/**
 * TwiML played once the reply is complete: read back what we heard and hang up.
 */
export function buildCollectTwiml(transcript: string | undefined): string {
  const vr = new VoiceResponse();
  if (transcript && transcript.trim()) {
    vr.say(say, "Got it. I have everything I need. I will take it from here. Goodbye.");
  } else {
    vr.say(say, "Sorry, I did not catch that. I will follow up in text instead. Goodbye.");
  }
  vr.hangup();
  return vr.toString();
}

// Accept speech (primary) and keypad digits (so the user can press a key if a
// noisy environment defeats speech recognition). speechTimeout:auto ends the
// capture automatically after a natural pause.
function gatherSpeech(vr: InstanceType<typeof VoiceResponse>, action: string, prompt: string): void {
  const gather = vr.gather({
    input: ["speech", "dtmf"],
    action,
    method: "POST",
    speechTimeout: config.speechTimeout,
    speechModel: "phone_call",
    language: gatherLanguage,
    profanityFilter: false,
    actionOnEmptyResult: true,
  });
  gather.say(say, prompt);
}
