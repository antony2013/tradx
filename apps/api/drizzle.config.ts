import { defineConfig } from 'drizzle-kit';
import { loadConfig } from './src/config/env';

const config = loadConfig({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_PATH: process.env.DATABASE_PATH ?? 'data/research.db',
});

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: config.databasePath,
  },
});
