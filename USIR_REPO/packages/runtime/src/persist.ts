import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage } from '@usir/protocol/storage';

export interface Persistable<T> {
  toJSON(): T;
  fromJSON(data: T): void;
}

export function saveJSON<T>(path: string, data: T): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadJSON<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export class JsonFileStorage implements Storage {
  save<T>(path: string, data: T): void {
    saveJSON(path, data);
  }

  load<T>(path: string): T | null {
    return loadJSON(path);
  }
}
