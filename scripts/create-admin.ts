import { hashPassword } from '../server/auth';
import { config } from '../server/config';
import { db } from '../server/db';

/**
 * Creates (or updates) a staff login. Use this for the real first administrator.
 *
 *   npm run admin:create -- --email you@sies.edu.in --name "Your Name" --password "a long password"
 *   npm run admin:create -- --email hod@sies.edu.in --name "Dr. X" --role hod --course "B.Sc. Information Technology" --password "..."
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Add it to your .env file first.');

  const email = arg('email');
  const name = arg('name');
  const password = arg('password');
  const role = (arg('role') ?? 'admin') as 'admin' | 'hod';
  const course = arg('course');
  const designation = arg('designation') ?? (role === 'hod' ? 'Head of Department' : 'Administrator');

  if (!email || !name || !password) {
    throw new Error('Usage: npm run admin:create -- --email <email> --name "<name>" --password "<password>" [--role admin|hod] [--course "<course>"]');
  }
  if (!['admin', 'hod'].includes(role)) throw new Error('--role must be admin or hod.');
  if (role === 'hod' && !course) throw new Error('An HOD needs --course "<course name>".');
  if (password.length < 10 || password.length > 72) throw new Error('Password must be 10 to 72 characters.');

  await db.query(
    `insert into admins (email, name, role, course, designation, password_hash)
     values ($1, $2, $3, $4, $5, $6)
     on conflict ((lower(email))) do update
        set name = excluded.name, role = excluded.role, course = excluded.course,
            designation = excluded.designation, password_hash = excluded.password_hash`,
    [email.trim(), name, role, role === 'hod' ? course : null, designation, await hashPassword(password)]
  );
  console.log(`Saved ${role} login for ${email}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
