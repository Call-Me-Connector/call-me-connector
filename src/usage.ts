import { query } from "./db.js";

/**
 * Monthly call metering for fair-use caps. Counts reset on the 1st of each
 * month (calendar month, UTC).
 */

export async function callsThisMonth(userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM call_events
     WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
    [userId]
  );
  return parseInt(rows[0]?.n ?? "0", 10);
}

export async function recordCall(userId: string): Promise<void> {
  await query(`INSERT INTO call_events (user_id) VALUES ($1)`, [userId]);
}
