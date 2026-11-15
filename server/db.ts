import pg from 'pg';
import { config } from './config';

// Return dates as 'YYYY-MM-DD' strings and numbers as JS numbers, which is what the frontend expects.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint (counts)

let pool: pg.Pool | null = null;

function sslOption(): pg.PoolConfig['ssl'] {
  if (config.databaseSsl === 'disable') return false;
  if (config.databaseSsl === 'require') return { rejectUnauthorized: false };
  // auto
  try {
    const host = new URL(config.databaseUrl).hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return local ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

function getPool(): pg.Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set.');
    }
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: sslOption(),
      max: config.dbPoolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  }
  return pool;
}

export const db = {
  query<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) {
    return getPool().query<T>(text, params as any[]);
  },

  /** Run several statements as one transaction. Rolls back if the callback throws. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure, the original error matters more
      }
      throw err;
    } finally {
      client.release();
    }
  },

  async end() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};

/** Today's date in India as 'YYYY-MM-DD'. Form open/close dates are compared against this. */
export async function todayInIndia(): Promise<string> {
  const { rows } = await db.query<{ today: string }>(
    `select ((now() at time zone 'Asia/Kolkata')::date)::text as today`
  );
  return rows[0].today;
}
