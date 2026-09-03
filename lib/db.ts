import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it in your Vercel project\'s Environment Variables.');
}

// Prisma Postgres (like most managed providers) already does connection
// pooling on its own side, so a standard pg.Pool here is safe even in a
// serverless environment — the provider absorbs the connection churn from
// functions spinning up and down, rather than this app needing to.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
