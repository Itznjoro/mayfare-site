# Backend setup — authentication

This adds real signup/login/logout to your site using Vercel Serverless
Functions + Neon Postgres (via Drizzle ORM). Your existing static site is
untouched — this just adds an `api/` folder alongside it.

## What's here

```
api/auth/signup.ts   POST — create an account
api/auth/login.ts    POST — log in
api/auth/logout.ts   POST — log out
api/auth/me.ts        GET — who's currently logged in (used by protected pages)

db/schema.ts          the two tables: users, sessions
lib/db.ts             database connection
lib/auth.ts           password hashing, sessions, cookies, lockout logic

drizzle.config.ts     config for generating/running migrations
package.json          dependencies
.env.example          copy to .env for local testing
```

## Setup steps (in order)

### 1. Database — already done ✅
You've connected **Prisma Postgres** through the Vercel Marketplace, which
already created a `DATABASE_URL` environment variable in your project
automatically. Nothing more needed here.

(Note: this project was originally written for Neon specifically, using
Neon's own HTTP driver. Since you ended up with Prisma Postgres instead —
a different provider — I updated `lib/db.ts` to use the standard
`node-postgres` driver instead, which is what Prisma Postgres actually
requires. Functionally nothing changes for you; just flagging it so you
know why the code looks slightly different from the original plan.)

### 2. Install dependencies locally (for testing before you deploy)
```bash
npm install
```

### 3. Set up your local `.env`
```bash
cp .env.example .env
```
Then paste your real Prisma Postgres connection string into `.env` — you
already have this: it's the `DATABASE_URL` value shown (redacted) in the
screenshot of your Prisma Postgres dashboard, under **Show secret**. This
file is already in `.gitignore`, so it won't get committed.

### 4. Create the database tables
```bash
npm run db:generate   # generates the SQL migration from db/schema.ts
npm run db:migrate    # runs it against your actual database
```
Run this once now, and again any time you or I change `db/schema.ts`.

### 5. Deploy to Vercel
Push this project to your connected Git repo (or run `vercel deploy` directly
if you're using the CLI). Vercel will detect the `api/` folder automatically
and deploy each file in it as its own serverless function — no extra config
needed. Since `DATABASE_URL` is already set in your Vercel project (step 1),
it'll be available to the deployed functions automatically too.

### 6. Connect the frontend forms
Right now, `login.html` and `signup.html` still just redirect to the
dashboard with a fake `localStorage` flag (the placeholder I mentioned
earlier). Once your database is live, tell me and I'll swap that out for
real `fetch()` calls to these new endpoints, with proper error messages
shown to the user on failure.

## What I need from you to move forward

1. **Confirmation the Neon database is created** in your Vercel project (step 1).
2. **Whether you want to run the migration yourself** (steps 2–4 above), or
   whether you'd rather paste me the connection string so I can walk through
   it with you — up to you, either works. (If you do share it, treat it as a
   secret: rotate it afterward if you're ever unsure where it's been pasted.)
3. **Any additional signup fields** beyond Full Name, Email, Telegram, and
   Password (the ones your form already collects) — e.g. do you want phone
   number, country, or referral code captured at signup? This is the moment
   to add them, since it directly feeds into the profile page work next.

Once the database is actually reachable, I'll also want to run a real
end-to-end test (create an account, log in, confirm the session cookie
works) before we wire it into the live login/signup pages.
