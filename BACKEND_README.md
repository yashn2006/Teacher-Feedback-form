# Backend setup (Express + TypeScript + Supabase)

Copy these files over your repo (same paths), then:

1. `npm install`
2. Supabase: create a project -> Project Settings -> Database -> copy the connection string
   (URL-encode special characters in the password, e.g. `@` -> `%40`).
3. `cp .env.example .env` and set `DATABASE_URL`, `JWT_SECRET` (long random string),
   optionally `DEEPSEEK_API_KEY` or `GEMINI_API_KEY` for AI question generation
   (without keys a built-in mock generator is used).
4. Create tables: `npm run db:schema` (or paste `supabase/schema.sql` in the Supabase SQL Editor).
5. Either
   - demo data: `npm run db:seed`  (students log in with the roll number and INITIAL_STUDENT_PASSWORD, default `Password@123`), or
   - real use: `npm run admin:create -- --email you@college.edu --name "Your Name" --password "..."`
     (HOD: add `--role hod --course "B.Sc. IT"`).
6. `npm run dev` -> http://localhost:3000
7. Tests (need a local throwaway Postgres, they wipe it): set TEST_DATABASE_URL, then `npm test`.

Behind a proxy/host (Render, Railway, etc.) set `TRUST_PROXY=1` and `NODE_ENV=production`, build with `npm run build`.
