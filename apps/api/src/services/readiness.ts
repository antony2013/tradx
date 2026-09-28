import type { DatabaseContainer } from '../db';

export async function checkReadiness(
  database: DatabaseContainer,
): Promise<{ database: 'ready' }> {
  database.client.query('SELECT 1').get();
  return { database: 'ready' };
}
