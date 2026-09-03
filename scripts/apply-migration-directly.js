// One-off recovery script: applies drizzle/0001_financial_and_trading_tables.sql
// directly against DATABASE_URL, statement by statement, skipping any
// statement that fails because its target already exists (safe to re-run).
//
// Usage:  node scripts/apply-migration-directly.js
// Requires .env in this folder with a real DATABASE_URL (same as always).

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env manually (no dotenv dependency needed for this one-off script)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Make sure .env exists in this folder.');
  process.exit(1);
}

const migrationPath = path.join(__dirname, '..', 'drizzle', '0001_financial_and_trading_tables.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await pool.query(statement);
      applied++;
      console.log('✓ Applied:', statement.split('\n')[0].slice(0, 70));
    } catch (err) {
      if (err.code === '42P07' || err.code === '42710' || err.code === '42701') {
        // 42P07 = relation already exists, 42710 = type already exists,
        // 42701 = column already exists — safe to skip, means this
        // particular piece already applied in an earlier partial attempt.
        skipped++;
        console.log('· Skipped (already exists):', statement.split('\n')[0].slice(0, 70));
      } else {
        console.error('✗ FAILED on statement:', statement.split('\n')[0].slice(0, 70));
        console.error(err.message);
        await pool.end();
        process.exit(1);
      }
    }
  }

  console.log(`\nDone. Applied: ${applied}, Skipped (already existed): ${skipped}`);
  await pool.end();
}

main();
