export interface Storage {
  save<T>(path: string, data: T): void;
  load<T>(path: string): T | null;
}
