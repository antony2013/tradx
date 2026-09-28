import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { projectRoot } from '../src/config/env';
import { closeDatabase, createDatabase, pingDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import { databaseProbe } from '../src/db/schema';

const database = createDatabase(':memory:');
runMigrations(database, join(projectRoot, 'drizzle'));

afterAll(async () => {
  await closeDatabase(database);
});

describe('SQLite and Drizzle', () => {
  it('opens SQLite and executes a Drizzle query', async () => {
    await pingDatabase(database);
    const result = database.client.query('SELECT 1 AS value').get();

    expect(result).toBeDefined();
  });

  it('reads and writes through the Drizzle client', async () => {
    await database.db.insert(databaseProbe).values({ marker: 'foundation' }).run();
    const rows = await database.db.select().from(databaseProbe).all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.marker).toBe('foundation');
  });
});
