import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { JsonFileStorage } from './persist';
import { SqliteStorage } from './sqlite-storage';

const TMP = '/tmp/usir-persist-test';

describe('JsonFileStorage', () => {
  const storage = new JsonFileStorage();

  it('save and load roundtrip', () => {
    const path = `${TMP}-json.json`;
    storage.save(path, { hello: 'world', num: 42 });
    const loaded = storage.load<{ hello: string; num: number }>(path);
    expect(loaded).toEqual({ hello: 'world', num: 42 });
    unlinkSync(path);
  });

  it('load returns null for missing file', () => {
    const result = storage.load('/tmp/usir-nonexistent-test-file.json');
    expect(result).toBeNull();
  });
});

describe('SqliteStorage', () => {
  it('throws descriptive error when better-sqlite3 is not installed', () => {
    expect(() => new SqliteStorage()).not.toThrow();
    const storage = new SqliteStorage();
    expect(() => storage.save('test', {})).toThrow(
      /better-sqlite3/,
    );
  });
});
