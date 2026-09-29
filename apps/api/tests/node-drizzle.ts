import { Database } from './bun-sqlite';
import { NoopLogger } from 'drizzle-orm/logger';
// mapResultRow ships in drizzle-orm at runtime but has no public types in
// this version; the test shim is its only consumer.
// @ts-expect-error: untyped drizzle runtime helper
import { mapResultRow } from 'drizzle-orm';
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
} from 'drizzle-orm/relations';
import { fillPlaceholders, sql } from 'drizzle-orm/sql';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

type NativeTransaction = {
  (): unknown;
  deferred: () => unknown;
  immediate: () => unknown;
  exclusive: () => unknown;
};

type Query = {
  sql: string;
  params: unknown[];
};

class NodePreparedQuery {
  constructor(
    private readonly statement: any,
    readonly query: Query,
    private readonly logger: any,
    private readonly fields: any,
    private readonly executeMethod: 'run' | 'all' | 'get',
    private readonly isArrayMode: boolean,
    private readonly customResultMapper?: any,
  ) {}

  run(placeholderValues?: Record<string, unknown>) {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    return this.statement.run(...params);
  }

  all(placeholderValues?: Record<string, unknown>) {
    if (!this.fields && !this.customResultMapper) {
      const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
      this.logger.logQuery(this.query.sql, params);
      return this.statement.all(...params);
    }
    const rows = this.values(placeholderValues);
    if (this.customResultMapper) {
      return this.customResultMapper(rows);
    }
    return rows.map((row: unknown[]) =>
      mapResultRow(this.fields, row, undefined),
    );
  }

  get(placeholderValues?: Record<string, unknown>) {
    if (!this.fields && !this.customResultMapper) {
      return this.all(placeholderValues)?.[0];
    }
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    const row = this.statement.values(...params)[0];
    if (!row) {
      return undefined;
    }
    if (this.customResultMapper) {
      return this.customResultMapper([row]);
    }
    return mapResultRow(this.fields, row, undefined);
  }

  values(placeholderValues?: Record<string, unknown>) {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    // Raw array-mode rows in SELECT column order (mirrors stmt.values()).
    return this.statement
      .all(...params)
      .map((row: Record<string, unknown>) => Object.values(row));
  }

  execute(placeholderValues?: Record<string, unknown>) {
    return this[this.executeMethod](placeholderValues);
  }

  isResponseInArrayMode() {
    return this.isArrayMode;
  }
}

class NodeSQLiteSession {
  constructor(
    readonly dialect: SQLiteSyncDialect,
    private readonly client: Database,
    private readonly logger: any,
    private readonly schema?: any,
  ) {}

  private toQuery(query: any): Query {
    if (typeof query === 'string') {
      return { sql: query, params: [] };
    }
    if (
      query &&
      typeof query.sql === 'string' &&
      Array.isArray(query.params)
    ) {
      return query;
    }
    return this.dialect.sqlToQuery(query);
  }

  prepareQuery(
    query: any,
    _fields: any,
    executeMethod: 'run' | 'all' | 'get',
    isArrayMode: boolean,
    customResultMapper?: any,
  ) {
    const normalized = this.toQuery(query);
    return new NodePreparedQuery(
      this.client.prepare(normalized.sql),
      normalized,
      this.logger,
      _fields,
      executeMethod,
      isArrayMode,
      customResultMapper,
    );
  }

  // drizzle-orm >= 0.44 routes one-time queries through
  // prepareOneTimeQuery; the node:sqlite shim executes them identically.
  prepareOneTimeQuery(
    query: any,
    _fields: any,
    executeMethod: 'run' | 'all' | 'get',
    isArrayMode: boolean,
    customResultMapper?: any,
  ) {
    return this.prepareQuery(
      query,
      _fields,
      executeMethod,
      isArrayMode,
      customResultMapper,
    );
  }

  run(query: any) {
    return this.prepareQuery(query, undefined, 'run', false).run();
  }

  all(query: any) {
    return this.prepareQuery(query, undefined, 'all', false).all();
  }

  get(query: any) {
    return this.prepareQuery(query, undefined, 'get', false).get();
  }

  values(query: any) {
    return this.prepareQuery(query, undefined, 'all', false).values();
  }

  transaction(callback: (tx: any) => unknown, config: any = {}) {
    // Mirror real drizzle: the callback receives a full database facade
    // (tx.insert/tx.update/...), not the bare session.
    // Stays SYNCHRONOUS for sync callbacks so BEGIN..COMMIT is atomic with
    // no interleaving microtask (matches bun:sqlite). Async callbacks go
    // through a promise path with the same autocommit caveat as the real
    // driver: only use sync callbacks for atomicity.
    const txSession = new NodeSQLiteTransaction(this, this.dialect, this.schema);
    const txDb = new BaseSQLiteDatabase(
      'sync',
      this.dialect,
      txSession as any,
      this.schema as any,
    ) as any;
    const behavior: 'deferred' | 'immediate' | 'exclusive' =
      config.behavior ?? 'deferred';
    this.client.exec(`BEGIN ${behavior}`);
    let result: unknown;
    try {
      result = callback(txDb);
    } catch (error) {
      this.client.exec('ROLLBACK');
      throw error;
    }
    if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(
        (value) => {
          this.client.exec('COMMIT');
          return value;
        },
        (error) => {
          this.client.exec('ROLLBACK');
          throw error;
        },
      );
    }
    this.client.exec('COMMIT');
    return result;
  }
}

class NodeSQLiteTransaction {
  constructor(
    private readonly session: NodeSQLiteSession,
    private readonly dialect: SQLiteSyncDialect,
    private readonly schema?: any,
    private readonly nestedIndex = 0,
  ) {}

  run(query: any) {
    return this.session.run(query);
  }

  // Drizzle routes query execution through prepareOneTimeQuery/execute;
  // forward to the underlying session so tx queries build identically.
  prepareOneTimeQuery(
    query: any,
    fields: any,
    executeMethod: 'run' | 'all' | 'get',
    isArrayMode: boolean,
    customResultMapper?: any,
  ) {
    return this.session.prepareOneTimeQuery(
      query,
      fields,
      executeMethod,
      isArrayMode,
      customResultMapper,
    );
  }

  execute(query: any) {
    return this.session.prepareOneTimeQuery(query, undefined, 'all', false).all();
  }

  all(query: any) {
    return this.session.all(query);
  }

  get(query: any) {
    return this.session.get(query);
  }

  values(query: any) {
    return this.session.values(query);
  }

  transaction(callback: (tx: NodeSQLiteTransaction) => unknown) {
    const savepointName = `sp${this.nestedIndex}`;
    const tx = new NodeSQLiteTransaction(
      this.session,
      this.dialect,
      this.schema,
      this.nestedIndex + 1,
    );
    this.session.run(sql.raw(`savepoint ${savepointName}`));
    try {
      const result = callback(tx);
      this.session.run(sql.raw(`release savepoint ${savepointName}`));
      return result;
    } catch (error) {
      this.session.run(sql.raw(`rollback to savepoint ${savepointName}`));
      throw error;
    }
  }
}

function construct(client: Database, config: any = {}) {
  const dialect = new SQLiteSyncDialect({ casing: config.casing });
  const logger = config.logger === true ? new NoopLogger() : config.logger ?? new NoopLogger();
  const schema = config.schema
    ? extractTablesRelationalConfig(
        config.schema,
        createTableRelationsHelpers,
      )
    : undefined;
  const session = new NodeSQLiteSession(dialect, client, logger, schema);
  const database = new BaseSQLiteDatabase(
    'sync',
    dialect,
    session as any,
    schema as any,
  ) as any;
  database.$client = client;
  return database;
}

export function drizzle(clientOrConfig?: any, config?: any) {
  if (clientOrConfig && typeof clientOrConfig === 'object' && 'client' in clientOrConfig) {
    return construct(clientOrConfig.client, clientOrConfig);
  }
  if (clientOrConfig && typeof clientOrConfig === 'object' && 'connection' in clientOrConfig) {
    const { connection, ...drizzleConfig } = clientOrConfig;
    if (typeof connection === 'object') {
      const { source, ...options } = connection;
      return construct(new Database(source), { ...drizzleConfig, ...options });
    }
    return construct(new Database(connection), drizzleConfig);
  }
  if (typeof clientOrConfig === 'string') {
    return construct(new Database(clientOrConfig), config);
  }
  return construct(clientOrConfig, config);
}

drizzle.mock = (config?: any) => construct(new Database(':memory:'), config);
