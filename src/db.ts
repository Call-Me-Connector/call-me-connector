import pg from "pg";
import { config } from "./config.js";

/**
 * Postgres connection pool + schema bootstrap for multi-tenant mode.
 *
 * Only used when DATABASE_URL is set. In single-user mode this module's pool is
 * never initialized, so the connector runs exactly as before.
 */

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is not set — multi-tenant features are unavailable.");
    }
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // Render/most hosted Postgres require SSL. rejectUnauthorized:false is
      // standard for managed providers that use self-signed chains.
      ssl: config.databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
    pool.on("error", (err) => console.error("[db] idle client error:", err));
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Create tables if they don't exist. Safe to run on every boot (idempotent).
 * Called from server startup only when multi-tenant mode is on.
 */
export async function initSchema(): Promise<void> {
  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      phone_e164    text,
      phone_verified boolean NOT NULL DEFAULT false,
      tier          text NOT NULL DEFAULT 'basic',
      stripe_customer_id text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id     text PRIMARY KEY,
      redirect_uris jsonb NOT NULL,
      name          text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token       text PRIMARY KEY,
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id   text NOT NULL,
      scope       text NOT NULL,
      expires_at  timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);
  `);
  console.log("[db] schema ready");
}
