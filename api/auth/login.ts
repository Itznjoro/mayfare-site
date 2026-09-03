import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../db/schema';
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  publicUser,
  isLockedOut,
  recordFailedLogin,
  resetFailedLogins,
} from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
