import { describe, it, expect } from 'vitest';
import { RegistryStore } from './registry-store';
import type { Capability, PublisherIdentity } from '@usir/protocol/capability';

function sampleCapability(overrides?: Partial<Capability>): Capability {
  return {
    capabilityId: 'cap://test/echo/v1',
    displayName: 'Echo Test',
    handlesIntents: ['intent.test'],
    intentLayers: ['L1'],
    provider: { id: 'provider-1', name: 'Provider One', trustScore: 0.9 },
    pricing: { model: 'free' },
    requiredPermissions: ['read'],
    endpoint: { protocol: 'in-process' },
    metadata: { version: '1.0.0', description: 'An echo capability for testing' },
    ...overrides,
  };
}

const samplePublisher: PublisherIdentity = {
  publisherId: 'pub-1',
  name: 'Publisher One',
  publicKey: 'key-abc',
};

describe('RegistryStore', () => {
  it('publishes a capability and retrieves it', () => {
    const store = new RegistryStore();
    const listing = store.publish(sampleCapability(), 'development', samplePublisher, ['test']);

    expect(listing.capability.capabilityId).toBe('cap://test/echo/v1');
    expect(listing.status).toBe('active');
    expect(listing.registryMetadata.tags).toEqual(['test']);

    const retrieved = store.getListing('cap://test/echo/v1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.capability.displayName).toBe('Echo Test');
  });

  it('updates existing capability on re-publish', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability(), 'development', samplePublisher);

    const updated = store.publish(
      sampleCapability({ displayName: 'Echo V2', metadata: { version: '2.0.0', description: 'Updated' } }),
      'development',
      samplePublisher,
    );

    expect(updated.capability.displayName).toBe('Echo V2');
    expect(updated.registryMetadata.updatedAt).toBeGreaterThan(0);
  });

  it('unpublishes a capability (soft delete)', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability(), 'development', samplePublisher);

    const result = store.unpublish('cap://test/echo/v1');
    expect(result).toBe(true);

    const listing = store.getListing('cap://test/echo/v1');
    expect(listing!.status).toBe('removed');
  });

  it('hard deletes a capability', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability(), 'development', samplePublisher);

    const result = store.delete('cap://test/echo/v1');
    expect(result).toBe(true);
    expect(store.getListing('cap://test/echo/v1')).toBeUndefined();
  });

  it('returns false for unpublish/delete on non-existent capability', () => {
    const store = new RegistryStore();
    expect(store.unpublish('nonexistent')).toBe(false);
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('searches capabilities by query string', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability({ capabilityId: 'cap://test/alpha/v1', displayName: 'Alpha Cap' }), 'development', samplePublisher, ['test']);
    store.publish(sampleCapability({ capabilityId: 'cap://test/beta/v1', displayName: 'Beta Service' }), 'development', samplePublisher, ['prod']);

    const result = store.search({ query: 'alpha' });
    expect(result.total).toBe(1);
    expect(result.items[0].capability.displayName).toBe('Alpha Cap');
  });

  it('filters by category', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability({ capabilityId: 'cap://dev/1' }), 'development', samplePublisher);
    store.publish(sampleCapability({ capabilityId: 'cap://iot/1' }), 'iot', samplePublisher);

    const dev = store.search({ category: 'development' });
    expect(dev.total).toBe(1);
    expect(dev.items[0].capability.capabilityId).toBe('cap://dev/1');

    const iot = store.search({ category: 'iot' });
    expect(iot.total).toBe(1);
  });

  it('filters by tags', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability({ capabilityId: 'cap://tag/a' }), 'development', samplePublisher, ['alpha', 'beta']);
    store.publish(sampleCapability({ capabilityId: 'cap://tag/b' }), 'development', samplePublisher, ['beta', 'gamma']);

    const alpha = store.search({ tags: ['alpha'] });
    expect(alpha.total).toBe(1);

    const beta = store.search({ tags: ['beta'] });
    expect(beta.total).toBe(2);

    const gamma = store.search({ tags: ['gamma'] });
    expect(gamma.total).toBe(1);
  });

  it('filters by intent type', () => {
    const store = new RegistryStore();
    store.publish(
      sampleCapability({ capabilityId: 'cap://int/a', handlesIntents: ['intent.test'] }),
      'development', samplePublisher,
    );
    store.publish(
      sampleCapability({ capabilityId: 'cap://int/b', handlesIntents: ['intent.other'] }),
      'development', samplePublisher,
    );

    const result = store.search({ intentType: 'intent.test' });
    expect(result.total).toBe(1);
    expect(result.items[0].capability.capabilityId).toBe('cap://int/a');
  });

  it('filters by minimum trust score', () => {
    const store = new RegistryStore();
    store.publish(
      sampleCapability({ capabilityId: 'cap://trust/high', provider: { id: 'p1', name: 'P1', trustScore: 0.9 } }),
      'development', samplePublisher,
    );
    store.publish(
      sampleCapability({ capabilityId: 'cap://trust/low', provider: { id: 'p2', name: 'P2', trustScore: 0.3 } }),
      'development', samplePublisher,
    );

    const result = store.search({ minTrustScore: 0.5 });
    expect(result.total).toBe(1);
    expect(result.items[0].capability.capabilityId).toBe('cap://trust/high');
  });

  it('respects offset and limit for pagination', () => {
    const store = new RegistryStore();
    for (let i = 0; i < 10; i++) {
      store.publish(
        sampleCapability({ capabilityId: `cap://page/${i}`, displayName: `Cap ${i}` }),
        'development', samplePublisher,
      );
    }

    const page1 = store.search({ limit: 3, offset: 0 });
    expect(page1.items).toHaveLength(3);
    expect(page1.total).toBe(10);

    const page2 = store.search({ limit: 3, offset: 3 });
    expect(page2.items).toHaveLength(3);
    expect(page2.items[0].capability.capabilityId).toBe('cap://page/3');
  });

  it('provides registry stats', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability({ capabilityId: 'cap://stats/a' }), 'development', samplePublisher);
    store.publish(sampleCapability({ capabilityId: 'cap://stats/b' }), 'iot', samplePublisher);

    const stats = store.getStats();
    expect(stats.totalCapabilities).toBe(2);
    expect(stats.totalPublishers).toBe(1);
    expect(stats.categories.development).toBe(1);
    expect(stats.categories.iot).toBe(1);
    expect(stats.averageTrustScore).toBe(0.9);
    expect(typeof stats.uptime).toBe('number');
  });

  it('lists capabilities by publisher', () => {
    const store = new RegistryStore();
    store.publish(sampleCapability({ capabilityId: 'cap://pub/a' }), 'development', samplePublisher);
    store.publish(sampleCapability({ capabilityId: 'cap://pub/b' }), 'iot', samplePublisher);

    const publisher2: PublisherIdentity = { publisherId: 'pub-2', name: 'Publisher Two', publicKey: 'key-xyz' };
    store.publish(sampleCapability({ capabilityId: 'cap://pub/c' }), 'development', publisher2);

    const pub1 = store.listByPublisher('pub-1');
    expect(pub1).toHaveLength(2);

    const pub2 = store.listByPublisher('pub-2');
    expect(pub2).toHaveLength(1);
  });
});
