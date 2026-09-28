import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { DatabaseContainer } from './index';

export function runMigrations(
  database: DatabaseContainer,
  migrationsFolder: string,
): void {
  migrate(database.db, { migrationsFolder });
}
