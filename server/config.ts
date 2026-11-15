import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

const GEMINI_PLACEHOLDER = 'MY_GEMINI_API_KEY';

function pickAiProvider(): 'deepseek' | 'gemini' | 'mock' {
  const forced = (process.env.AI_PROVIDER ?? '').toLowerCase();
  if (forced === 'deepseek' || forced === 'gemini' || forced === 'mock') return forced;
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini && gemini !== GEMINI_PLACEHOLDER) return 'gemini';
  return 'mock';
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),

  /** Supabase: Project Settings > Database > Connection string (URI). */
  databaseUrl: process.env.DATABASE_URL ?? '',
  /** auto = TLS for remote hosts, off for localhost. Or force with require / disable. */
  databaseSsl: (process.env.DATABASE_SSL ?? 'auto').toLowerCase(),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),

  /** Signs login cookies. Must be a long random string in production. */
  jwtSecret: process.env.JWT_SECRET ?? (isProd ? '' : 'dev-only-secret-change-me-dev-only-secret'),
  studentSessionHours: 8,
  adminSessionHours: 12,

  /** Number of reverse proxies in front of the app (Cloud Run, Render, etc. = 1). */
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),

  /** Password given to students created by the Excel import. They must change it on first login. */
  initialStudentPassword: process.env.INITIAL_STUDENT_PASSWORD ?? 'Password@123',

  ai: {
    provider: pickAiProvider(),
    deepseekKey: process.env.DEEPSEEK_API_KEY ?? '',
    deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    geminiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-4-hydrogen',
  },
};

/** Call once at startup. Throws a readable error if something required is missing. */
export function assertConfig() {
  const problems: string[] = [];
  if (!config.databaseUrl) {
    problems.push('DATABASE_URL is not set (copy it from Supabase: Project Settings > Database).');
  }
  if (config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random string of at least 32 characters.');
  }
  if (problems.length > 0) {
    throw new Error(`Configuration problem:\n- ${problems.join('\n- ')}`);
  }
}
