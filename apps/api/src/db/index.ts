import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from './sqlite';
import { drizzle } from './orm';

export function createDatabase(databasePath: string) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const client = new Database(databasePath);
  const db = drizzle({ client });

  return { client, db };
}

export type DatabaseContainer = ReturnType<typeof createDatabase>;

export async function closeDatabase(database: DatabaseContainer): Promise<void> {
  database.client.close();
}

export async function pingDatabase(database: DatabaseContainer): Promise<void> {
  database.client.query('SELECT 1').get();
}
