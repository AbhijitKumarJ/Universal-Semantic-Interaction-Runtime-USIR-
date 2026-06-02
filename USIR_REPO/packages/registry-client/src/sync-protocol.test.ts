import { describe, it, expect, vi } from 'vitest';
import { SyncProtocol } from './sync-protocol';
import { LocalCapabilityCache } from './local-cache';
import type { RegistryClient } from './registry-client';

function mockClient(): RegistryClient {
  return {
    search: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  } as unknown as RegistryClient;
}

describe('SyncProtocol', () => {
  it('starts and stops without error', () => {
    const client = mockClient();
    const cache = new LocalCapabilityCache();
    const sync = new SyncProtocol(client, cache, { intervalMs: 5000 });

    expect(sync.isRunning).toBe(false);
    sync.start();
    expect(sync.isRunning).toBe(true);
    sync.stop();
    expect(sync.isRunning).toBe(false);
  });

  it('calls onSync after a sync cycle', async () => {
    const client = mockClient();
    const cache = new LocalCapabilityCache();
    const onSync = vi.fn();

    const sync = new SyncProtocol(client, cache, { intervalMs: 5000, onSync });
    await sync.syncOnce();

    expect(onSync).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it('calls onError when search fails', async () => {
    const client = mockClient();
    (client.search as any).mockRejectedValue(new Error('Network error'));
    const cache = new LocalCapabilityCache();
    const onError = vi.fn();

    const sync = new SyncProtocol(client, cache, { intervalMs: 5000, onError });
    await sync.syncOnce();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network error' }));
    sync.stop();
  });
});
