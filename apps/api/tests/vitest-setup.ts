import { vi } from 'vitest';

vi.mock('../src/db/sqlite', () => import('./bun-sqlite'));
vi.mock('../src/db/orm', () => import('./node-drizzle'));
