import { randomUUID } from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";

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
  /** The user who initiated this call (multi-tenant ownership). */
  userId: string;
  to: string;
  createdAt: number;
  status: CallStatus;
  twilioSid?: string;
  summary: string;
  questions: string[];
  nextSteps?: string;
  /** Multi-turn mode: keep re-gathering until the user says "done". */
  conversational: boolean;
  /** One-time welcome/demo call placed right after phone verification. */
  welcome?: boolean;
  /** Each spoken utterance captured during a conversational call. */
  turns: string[];
  /**
   * The user's final reply. In one-shot mode this is the single utterance; in
   * conversational mode it's the joined turns, set once the call finalizes.
   */
  transcript?: string;
  /** Twilio's confidence in the last transcription, 0..1. */
  confidence?: number;
  /** True when this call may fall back to SMS (Pro tier + SMS enabled), decided at creation. */
  smsEligible?: boolean;
  /** Set once we've texted the summary because the call wasn't answered. */
  smsFallback?: boolean;
  smsSid?: string;
  error?: string;
  completedAt?: number;
}

const TERMINAL_FAILURES: CallStatus[] = ["busy", "no-answer", "failed", "canceled"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call state, keyed by our own call id. An in-process Map is the fast path; when
 * a database is configured (multi-tenant mode) every record is also written
 * through to Postgres so a redeploy or restart mid-call doesn't lose it — the
 * Twilio webhooks and get_call_result rehydrate from the DB on a memory miss.
 */
class CallStore {
  private calls = new Map<string, CallRecord>();
  private opCount = 0;

  create(input: {
    userId: string;
    summary: string;
    questions: string[];
    nextSteps?: string;
    to: string;
    conversational?: boolean;
    welcome?: boolean;
    smsEligible?: boolean;
  }): CallRecord {
    const rec: CallRecord = {
      id: randomUUID(),
      userId: input.userId,
      to: input.to,
      createdAt: Date.now(),
      status: "queued",
      summary: input.summary,
      questions: input.questions,
      nextSteps: input.nextSteps,
      conversational: input.conversational ?? false,
      welcome: input.welcome ?? false,
      smsEligible: input.smsEligible ?? false,
      turns: [],
    };
    this.calls.set(rec.id, rec);
    this.persist(rec);
    this.evictOld();
    return rec;
  }

  /** Synchronous, in-memory only. Use getOrLoad when a DB fallback is needed. */
  get(id: string): CallRecord | undefined {
    return this.calls.get(id);
  }

  /** In-memory first, then Postgres (rehydrating into memory). Survives restarts. */
  async getOrLoad(id: string): Promise<CallRecord | undefined> {
    const inMem = this.calls.get(id);
    if (inMem || !config.multiTenant) return inMem;
    try {
      const { rows } = await query<{ data: CallRecord }>(`SELECT data FROM calls WHERE id = $1`, [id]);
      const rec = rows[0]?.data;
      if (rec) {
        this.calls.set(rec.id, rec);
        return rec;
      }
    } catch (e) {
      console.error("[store] load failed:", e);
    }
    return undefined;
  }

  update(id: string, patch: Partial<CallRecord>): CallRecord | undefined {
    const rec = this.calls.get(id);
    if (!rec) return undefined;
    Object.assign(rec, patch);
    if (patch.status && ["completed", ...TERMINAL_FAILURES].includes(patch.status)) {
      rec.completedAt ??= Date.now();
    }
    this.persist(rec);
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
      // If we've fallen back to SMS, don't block on the (slow, async) texted reply —
      // return now so the tool tells the assistant to fetch it later.
      if (rec.smsFallback) return rec;
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
    if (utterance.trim()) {
      rec.turns.push(utterance.trim());
      this.persist(rec);
    }
    return rec;
  }

  /**
   * Find the most recent call to `phone` still awaiting a reply — used to attach an
   * inbound SMS to the right call. Only matches calls that texted (smsFallback) or are
   * conversational, and that haven't captured a reply yet. Falls back to the DB so an
   * inbound text still matches after a restart.
   */
  async findPendingByPhone(phone: string): Promise<CallRecord | undefined> {
    let best: CallRecord | undefined;
    for (const rec of this.calls.values()) {
      if (rec.to !== phone || rec.transcript != null) continue;
      if (!rec.smsFallback && !rec.conversational) continue;
      if (!best || rec.createdAt > best.createdAt) best = rec;
    }
    if (best || !config.multiTenant) return best;
    try {
      const { rows } = await query<{ data: CallRecord }>(
        `SELECT data FROM calls
         WHERE data->>'to' = $1 AND (data->>'transcript') IS NULL
           AND ( (data->>'smsFallback')::boolean IS TRUE OR (data->>'conversational')::boolean IS TRUE )
         ORDER BY (data->>'createdAt')::bigint DESC LIMIT 1`,
        [phone]
      );
      const rec = rows[0]?.data;
      if (rec) {
        this.calls.set(rec.id, rec);
        return rec;
      }
    } catch (e) {
      console.error("[store] findPendingByPhone db failed:", e);
    }
    return undefined;
  }

  /** Collapse the captured turns into the final transcript (idempotent). */
  finalize(id: string): CallRecord | undefined {
    const rec = this.calls.get(id);
    if (!rec) return undefined;
    if (rec.transcript == null && rec.turns.length) {
      rec.transcript = rec.turns.join(" ");
      this.persist(rec);
    }
    return rec;
  }

  /** Write-through to Postgres (fire-and-forget). No-op in single-user mode. */
  private persist(rec: CallRecord): void {
    if (!config.multiTenant) return;
    query(
      `INSERT INTO calls (id, user_id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [rec.id, rec.userId, JSON.stringify(rec)]
    ).catch((e) => console.error("[store] persist failed:", e));
  }

  /** Keep memory bounded (drop >1h old); occasionally prune stale DB rows too. */
  private evictOld(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, rec] of this.calls) {
      if (rec.createdAt < cutoff) this.calls.delete(id);
    }
    if (config.multiTenant && ++this.opCount % 50 === 0) {
      query(`DELETE FROM calls WHERE created_at < now() - interval '24 hours'`).catch(() => {});
    }
  }
}

export const store = new CallStore();
