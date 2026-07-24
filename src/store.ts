import { randomUUID } from "node:crypto";

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";

export interface CallRecord {
  id: string;
  to: string;
  createdAt: number;
  status: CallStatus;
  twilioSid?: string;
  summary: string;
  questions: string[];
  nextSteps?: string;
  /** Multi-turn mode: keep re-gathering until the user says "done". */
  conversational: boolean;
  /** Each spoken utterance captured during a conversational call. */
  turns: string[];
  /**
   * The user's final reply. In one-shot mode this is the single utterance; in
   * conversational mode it's the joined turns, set once the call finalizes.
   */
  transcript?: string;
  /** Twilio's confidence in the last transcription, 0..1. */
  confidence?: number;
  error?: string;
  completedAt?: number;
}

const TERMINAL_FAILURES: CallStatus[] = ["busy", "no-answer", "failed", "canceled"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Simple in-process store of call state, keyed by our own call id.
 *
 * For a personal, single-instance connector this is all you need. If you ever
 * run multiple instances behind a load balancer, swap this for Redis so the
 * Twilio webhook and the MCP request land on the same shared state.
 */
class CallStore {
  private calls = new Map<string, CallRecord>();

  create(input: {
    summary: string;
    questions: string[];
    nextSteps?: string;
    to: string;
    conversational?: boolean;
  }): CallRecord {
    const rec: CallRecord = {
      id: randomUUID(),
      to: input.to,
      createdAt: Date.now(),
      status: "queued",
      summary: input.summary,
      questions: input.questions,
      nextSteps: input.nextSteps,
      conversational: input.conversational ?? false,
      turns: [],
    };
    this.calls.set(rec.id, rec);
    this.evictOld();
    return rec;
  }

  get(id: string): CallRecord | undefined {
    return this.calls.get(id);
  }

  update(id: string, patch: Partial<CallRecord>): CallRecord | undefined {
    const rec = this.calls.get(id);
    if (!rec) return undefined;
    Object.assign(rec, patch);
    if (patch.status && ["completed", ...TERMINAL_FAILURES].includes(patch.status)) {
      rec.completedAt ??= Date.now();
    }
    return rec;
  }

  /**
   * Block until the user's spoken reply is captured, the call ends, or we time
   * out. Returns the latest record either way; callers inspect `transcript`.
   */
  async waitForReply(id: string, timeoutMs: number): Promise<CallRecord | undefined> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rec = this.calls.get(id);
      if (!rec) return undefined;
      if (rec.transcript != null) return rec;
      if (TERMINAL_FAILURES.includes(rec.status)) return rec;
      // The "completed" status callback can arrive a beat before or after the
      // speech webhook. Give the transcript a short grace window before giving
      // up on a call that hung up without any recognized speech.
      if (rec.status === "completed" && rec.completedAt && Date.now() - rec.completedAt > 3000) {
        return rec;
      }
      await sleep(500);
    }
    return this.calls.get(id);
  }

  /** Add one spoken utterance to a conversational call. */
  addTurn(id: string, utterance: string): CallRecord | undefined {
    const rec = this.calls.get(id);
    if (!rec) return undefined;
    if (utterance.trim()) rec.turns.push(utterance.trim());
    return rec;
  }

  /** Collapse the captured turns into the final transcript (idempotent). */
  finalize(id: string): CallRecord | undefined {
    const rec = this.calls.get(id);
    if (!rec) return undefined;
    if (rec.transcript == null && rec.turns.length) {
      rec.transcript = rec.turns.join(" ");
    }
    return rec;
  }

  /** Keep memory bounded: drop records older than an hour. */
  private evictOld(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, rec] of this.calls) {
      if (rec.createdAt < cutoff) this.calls.delete(id);
    }
  }
}

export const store = new CallStore();
