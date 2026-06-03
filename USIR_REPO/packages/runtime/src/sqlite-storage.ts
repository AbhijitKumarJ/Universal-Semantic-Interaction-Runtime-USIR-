import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { Storage } from '@usir/protocol/storage';

const _require = createRequire(import.meta.url);

interface SqliteRunResult {
  changes: number;
}

interface SqliteDb {
  prepare(sql: string): {
    run(...params: unknown[]): SqliteRunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

export class SqliteStorage implements Storage {
  private db: SqliteDb | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ':memory:';
  }

  private getDb(): SqliteDb {
    if (!this.db) {
      try {
        if (this.dbPath !== ':memory:') {
          const dir = dirname(this.dbPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        }
        const BetterSqlite3: new (path: string) => SqliteDb = _require('better-sqlite3');
        this.db = new BetterSqlite3(this.dbPath);
        this.db.prepare(
          'CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY, value TEXT)',
        ).run();
      } catch (e: any) {
        throw new Error(
          `SqliteStorage requires the 'better-sqlite3' package. ` +
          `Install it with: pnpm add better-sqlite3\n` +
          `Original error: ${e.message}`,
        );
      }
    }
    return this.db;
  }

  save<T>(path: string, data: T): void {
    const db = this.getDb();
    const value = JSON.stringify(data);
    db.prepare('INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)').run(path, value);
  }

  load<T>(path: string): T | null {
    const db = this.getDb();
    const row = db.prepare('SELECT value FROM storage WHERE key = ?').get(path) as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as T;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
