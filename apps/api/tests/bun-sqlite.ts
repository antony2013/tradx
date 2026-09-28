import { DatabaseSync, type StatementSync } from 'node:sqlite';

type Binding = Exclude<Parameters<StatementSync['run']>[number], Record<string, unknown>>;
type Row = NonNullable<ReturnType<StatementSync['get']>>;

class Statement {
  constructor(private readonly statement: StatementSync) {}

  run(...bindings: Binding[]) {
    return this.statement.run(...bindings);
  }

  all(...bindings: Binding[]) {
    return this.statement.all(...bindings);
  }

  get(...bindings: Binding[]) {
    return this.statement.get(...bindings);
  }

  values(...bindings: Binding[]) {
    return this.all(...bindings).map((row: Row) => Object.values(row));
  }

  finalize() {}
}

type Transaction = {
  (...args: unknown[]): unknown;
  deferred: (...args: unknown[]) => unknown;
  immediate: (...args: unknown[]) => unknown;
  exclusive: (...args: unknown[]) => unknown;
};

export class Database {
  private readonly database: DatabaseSync;

  constructor(filename = ':memory:') {
    this.database = new DatabaseSync(filename);
  }

  static open(filename = ':memory:') {
    return new Database(filename);
  }

  run(sql: string, ...bindings: Binding[]) {
    return this.database.prepare(sql).run(...bindings);
  }

  exec(sql: string) {
    this.database.exec(sql);
  }

  query(sql: string) {
    return new Statement(this.database.prepare(sql));
  }

  prepare(sql: string) {
    return new Statement(this.database.prepare(sql));
  }

  transaction(callback: (...args: unknown[]) => unknown): Transaction {
    const transaction = (...args: unknown[]) => {
      this.database.exec('BEGIN');
      try {
        const result = callback(...args);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };

    transaction.deferred = transaction;
    transaction.immediate = transaction;
    transaction.exclusive = transaction;
    return transaction;
  }

  close() {
    this.database.close();
  }
}
