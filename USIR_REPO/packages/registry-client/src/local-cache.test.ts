import { describe, it, expect } from 'vitest';
import { LocalCapabilityCache } from './local-cache';
import type { CapabilityListing } from '@usir/protocol/capability';

function sampleListing(overrides?: Partial<CapabilityListing>): CapabilityListing {
  return {
    capability: {
      capabilityId: 'cap://cache/test/v1',
      displayName: 'Cache Test',
      handlesIntents: ['intent.test'],
      intentLayers: ['L1'],
      provider: { id: 'prov-1', name: 'Provider', trustScore: 0.8 },
      pricing: { model: 'free' },
      requiredPermissions: ['read'],
      endpoint: { protocol: 'in-process' },
      metadata: { version: '1.0.0', description: 'Cache test' },
    },
    registryMetadata: {
      category: 'development',
      tags: ['test'],
      publishedAt: Date.now(),
      updatedAt: Date.now(),
    },
    status: 'active',
    ...overrides,
  };
}

describe('LocalCapabilityCache', () => {
  it('stores and retrieves capability listings', () => {
    const cache = new LocalCapabilityCache();
    const listing = sampleListing();
    cache.updateFromListing(listing);

    expect(cache.listingCount).toBe(1);
    expect(cache.getListing('cap://cache/test/v1')).toBeDefined();
    expect(cache.capabilities.has('cap://cache/test/v1')).toBe(true);
  });

  it('finds capabilities by intent type', () => {
    const cache = new LocalCapabilityCache();
    cache.updateFromListing(sampleListing());
    cache.updateFromListing(
      sampleListing({
        capability: {
          capabilityId: 'cap://other/v1',
          displayName: 'Other',
          handlesIntents: ['intent.other'],
          intentLayers: ['L1'],
          provider: { id: 'prov-1', name: 'P', trustScore: 0.5 },
          pricing: { model: 'free' },
          requiredPermissions: [],
          endpoint: { protocol: 'in-process' },
          metadata: { version: '1.0.0' },
        },
      }),
    );

    const testCaps = cache.findCapabilities('intent.test' as any);
    expect(testCaps).toHaveLength(1);
    expect(testCaps[0].capabilityId).toBe('cap://cache/test/v1');

    const otherCaps = cache.findCapabilities('intent.other' as any);
    expect(otherCaps).toHaveLength(1);
  });

  it('removes a capability', () => {
    const cache = new LocalCapabilityCache();
    cache.updateFromListing(sampleListing());
    cache.remove('cap://cache/test/v1');

    expect(cache.listingCount).toBe(0);
    expect(cache.getListing('cap://cache/test/v1')).toBeUndefined();
  });

  it('reports stale status based on maxAge', () => {
    const cache = new LocalCapabilityCache({ maxAgeMs: 0 });
    expect(cache.isStale).toBe(true);

    const cache2 = new LocalCapabilityCache({ maxAgeMs: 600_000 });
    cache2.updateFromListing(sampleListing());
    expect(cache2.isStale).toBe(false);
  });

  it('clears all data', () => {
    const cache = new LocalCapabilityCache();
    cache.updateFromListing(sampleListing());
    cache.updateFromListing(
      sampleListing({ capability: { ...sampleListing().capability, capabilityId: 'cap://other/v2' } }),
    );

    expect(cache.listingCount).toBe(2);
    cache.clear();
    expect(cache.listingCount).toBe(0);
    expect(cache.capabilities.size).toBe(0);
  });
});
