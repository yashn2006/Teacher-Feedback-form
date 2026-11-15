import { config } from '../server/config';
import { db } from '../server/db';
import { seedDemoData } from '../server/seed';

async function main() {
  const reset = process.argv.includes('--reset');
  const force = process.argv.includes('--force');

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Add it to your .env file first.');
  }
  if (config.isProd && !force) {
    throw new Error('Refusing to load demo data with NODE_ENV=production. Add --force if you really mean it.');
  }

  const r = await seedDemoData({ reset });
  console.log('Demo data loaded:', r);
  console.log('');
  console.log('Demo logins (change or delete these before real students use the system):');
  console.log('  Admin   admin@sies.edu.in   Admin@2026');
  console.log('  HOD     hod.cs@sies.edu.in  Hod@2026');
  console.log('  Student 24CS002             Password@123');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
