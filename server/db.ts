import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL 
});

export async function runAs(
  user: { id: string; role?: string }, 
  fn: (client: any) => Promise<any>
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.user_id = '${user.id.replace(/'/g, "''")}'`);
    await client.query(`SET LOCAL app.role = '${(user.role || 'user').replace(/'/g, "''")}'`);
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
