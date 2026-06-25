import { Pool, types } from 'pg';

// Parse DATE (OID 1082) as a raw string to prevent timezone-shift issues
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  max: 10, // Limit pool size for serverless environment
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export default pool;
