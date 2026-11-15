import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config';
import { db } from '../server/db';

/** Applies supabase/schema.sql. Safe to run more than once. Same as pasting it into the Supabase SQL Editor. */
async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Add it to your .env file first.');
  const sql = await readFile(path.resolve(process.cwd(), 'supabase/schema.sql'), 'utf8');
  await db.query(sql);
  console.log('Schema applied.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
