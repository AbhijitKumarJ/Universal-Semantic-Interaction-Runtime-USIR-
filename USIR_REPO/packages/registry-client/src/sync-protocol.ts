import type { RegistryClient } from './registry-client';
import type { LocalCapabilityCache } from './local-cache';

export interface SyncProtocolConfig {
  intervalMs: number;
  onSync?: (listingsCount: number) => void;
  onError?: (error: Error) => void;
}

export class SyncProtocol {
  private client: RegistryClient;
  private cache: LocalCapabilityCache;
  private config: SyncProtocolConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    client: RegistryClient,
    cache: LocalCapabilityCache,
    config?: Partial<SyncProtocolConfig>,
  ) {
    this.client = client;
    this.cache = cache;
    this.config = {
      intervalMs: config?.intervalMs ?? 60_000,
      onSync: config?.onSync,
      onError: config?.onError,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get lastSyncTime(): number {
    return this.cache['lastSync'];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.syncOnce();
    this.timer = setInterval(() => this.syncOnce(), this.config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncOnce(): Promise<void> {
    try {
      if (this.cache.isStale) {
        await this.cache.sync(this.client);
      } else {
        await this.cache.syncDelta(this.client);
      }
      this.config.onSync?.(this.cache.listingCount);
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
