import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  loadConfig,
  projectRoot,
} from '../src/config/env';

describe('configuration', () => {
  it('validates and resolves the database path', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '4321',
      DATABASE_PATH: 'data/research.db',
    });

    expect(config.NODE_ENV).toBe('production');
    expect(config.PORT).toBe(4321);
    expect(config.databasePath).toBe(
      resolve(projectRoot, 'data/research.db'),
    );
  });

  it('rejects a missing database path', () => {
    expect(() => loadConfig({ PORT: '3000' })).toThrow(EnvValidationError);
  });

  it('rejects an invalid port', () => {
    expect(() =>
      loadConfig({ PORT: '70000', DATABASE_PATH: 'data/research.db' }),
    ).toThrow(EnvValidationError);
  });
});
