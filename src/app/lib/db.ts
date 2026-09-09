import { Pool, types } from 'pg';

// Parse DATE (OID 1082) as a raw string to prevent timezone-shift issues
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  max: 10, // Limit pool size for serverless environment
  idleTimeoutMillis: 30000,
  // Neon's compute autosuspends when idle; the first connection after that has to wake it
  // up, which can take several seconds. Give that cold start enough headroom to finish.
  connectionTimeoutMillis: 20000,
});

export const query = (text: string, params?: any[]) => {
  // Checked here rather than at module load: a throw at import time makes the route
  // module fail to evaluate, so Next returns an HTML error page and callers doing
  // res.json() get "Unexpected token '<'" instead of the real reason.
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env (see .env.example) and restart the dev server.'
    );
  }
  return pool.query(text, params);
};

export default pool;
