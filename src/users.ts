import bcrypt from "bcryptjs";
import { query } from "./db.js";

/**
 * User accounts + their verified phone number. The heart of multi-tenancy:
 * each user's calls go to THEIR verified number.
 */

export interface User {
  id: string;
  email: string;
  phone_e164: string | null;
  phone_verified: boolean;
  tier: "basic" | "pro";
  stripe_customer_id: string | null;
  created_at: Date;
}

interface UserRow extends User {
  password_hash: string;
}

const PUBLIC_COLUMNS =
  "id, email, phone_e164, phone_verified, tier, stripe_customer_id, created_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Create a user with a bcrypt-hashed password. Throws if the email exists. */
export async function createUser(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error("Please enter a valid email address.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await query<User>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING ${PUBLIC_COLUMNS}`,
      [normalized, hash]
    );
    return rows[0];
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new Error("An account with that email already exists — try signing in.");
    }
    throw err;
  }
}

export async function findByEmail(email: string): Promise<User | null> {
  const { rows } = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = $1`,
    [normalizeEmail(email)]
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const { rows } = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Verify an email+password pair. Returns the user on success, null otherwise. */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [normalizeEmail(email)]
  );
  const row = rows[0];
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  const { password_hash: _omit, ...user } = row;
  return user;
}

/** Set (or change) a user's phone number. Resets verification to false. */
export async function setPhone(userId: string, e164: string): Promise<void> {
  await query(
    `UPDATE users SET phone_e164 = $2, phone_verified = false WHERE id = $1`,
    [userId, e164]
  );
}

export async function markPhoneVerified(userId: string): Promise<void> {
  await query(`UPDATE users SET phone_verified = true WHERE id = $1`, [userId]);
}

export async function setTier(userId: string, tier: "basic" | "pro"): Promise<void> {
  await query(`UPDATE users SET tier = $2 WHERE id = $1`, [userId, tier]);
}
