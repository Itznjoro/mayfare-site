import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../db/schema';
import { hashPassword, createSession, setSessionCookie, publicUser } from '../../lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
