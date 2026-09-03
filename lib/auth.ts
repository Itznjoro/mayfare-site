import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './db';
import { sessions, users } from '../db/schema';

const SESSION_COOKIE = 'mayfare_session';
const SESSION_DURATION_DAYS = 30;
const BCRYPT_ROUNDS = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ---- Passwords ----

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---- Cookies ----

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

export function setSessionCookie(res: VercelResponse, sessionId: string): void {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60;
  // httpOnly: JS can't read it (blocks XSS token theft)
  // Secure: cookie only sent over HTTPS
  // SameSite=Lax: meaningful CSRF mitigation while still allowing normal top-level navigation
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}

// ---- Sessions ----

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const [session] = await db.insert(sessions).values({ userId, expiresAt }).returning();
  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function getSessionIdFromRequest(req: VercelRequest): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] ?? null;
}

/**
 * Resolves the logged-in user from the request's session cookie.
 * Returns null if there's no session, it's expired, or the user no longer exists.
 * Never throws — safe to call and just check for a falsy result.
 */
export async function getUserFromRequest(req: VercelRequest) {
  const sessionId = getSessionIdFromRequest(req);
  if (!sessionId) return null;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session || session.expiresAt < new Date()) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user ?? null;
}

/**
 * Use at the top of any protected API route:
 *   const user = await requireAuth(req, res);
 *   if (!user) return; // requireAuth already sent the 401 response
 */
export async function requireAuth(req: VercelRequest, res: VercelResponse) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  return user;
}

// ---- Login lockout (brute-force mitigation without needing Redis) ----

export function isLockedOut(user: { lockedUntil: Date | null }): boolean {
  return !!user.lockedUntil && user.lockedUntil > new Date();
}

export async function recordFailedLogin(user: { id: string; failedLoginAttempts: number }) {
  const attempts = user.failedLoginAttempts + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
    : null;
  await db.update(users)
    .set({ failedLoginAttempts: attempts, lockedUntil, updatedAt: new Date() })
    .where(eq(users.id, user.id));
}

export async function resetFailedLogins(userId: string) {
  await db.update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ---- Shared shape for what we send back to the client ----
// Never include passwordHash, failedLoginAttempts, etc.

export function publicUser(user: { id: string; email: string; fullName: string; telegram: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    telegram: user.telegram,
    createdAt: user.createdAt,
  };
}
