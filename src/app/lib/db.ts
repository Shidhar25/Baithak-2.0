import { Pool } from 'pg';

const connectionString = 'postgresql://neondb_owner:npg_OweB4KtN0Ubl@ep-dark-wave-a1x2fqk9-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
  connectionString,
  max: 10, // Limit pool size for serverless environment
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export default pool;
