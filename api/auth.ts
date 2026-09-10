import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { users } from '../db/schema';
import { verifyPassword, createSession, setSessionCookie, publicUser, isLockedOut, recordFailedLogin, resetFailedLogins, getSessionIdFromRequest, deleteSession, clearSessionCookie, getUserFromRequest, hashPassword } from '../lib/auth';


export async function handleLogin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body ?? {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  // Same generic message whether the email doesn't exist or the password is
  // wrong — never reveal which one it was (prevents account enumeration).
  const invalidCredentials = () => res.status(401).json({ error: 'Invalid email or password.' });

  if (!user) return invalidCredentials();

  if (isLockedOut(user)) {
    return res.status(429).json({
      error: 'Too many failed attempts. Please try again in a few minutes.',
    });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user);
    return invalidCredentials();
  }

  await resetFailedLogins(user.id);

  const session = await createSession(user.id);
  setSessionCookie(res, session.id);

  return res.status(200).json({ user: publicUser(user) });
}


export async function handleLogout(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    await deleteSession(sessionId);
  }
  clearSessionCookie(res);

  return res.status(200).json({ ok: true });
}


export async function handleMe(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.status(200).json({ user: publicUser(user) });
}


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleSignup(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password, fullName, telegram } = req.body ?? {};

  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (typeof fullName !== 'string' || fullName.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing) {
    // Deliberately generic — don't reveal that this email is already registered.
    return res.status(400).json({ error: 'Could not create an account with those details.' });
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      passwordHash,
      fullName: fullName.trim(),
      telegram: typeof telegram === 'string' && telegram.trim() ? telegram.trim() : null,
    })
    .returning();

  const session = await createSession(user.id);
  setSessionCookie(res, session.id);

  return res.status(201).json({ user: publicUser(user) });
}

export async function handleChangePassword(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmPassword !== 'string') {
    return res.status(400).json({ error: 'Current password, new password, and confirmation are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New passwords do not match.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from your current password.' });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));

  return res.status(200).json({ ok: true, message: 'Password updated successfully.' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String(req.query.route || '').replace(/^\/+|\/+$/g, '');
  if (route === 'login') return handleLogin(req,res);
  if (route === 'logout') return handleLogout(req,res);
  if (route === 'me') return handleMe(req,res);
  if (route === 'signup') return handleSignup(req,res);
  if (route === 'change-password') return handleChangePassword(req,res);
  return res.status(404).json({ error: 'Not found' });
}
