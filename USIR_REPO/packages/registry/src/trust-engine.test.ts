import { describe, it, expect } from 'vitest';
import { TrustEngine } from './trust-engine';
import type { CapabilityListing } from '@usir/protocol/capability';

function sampleListing(overrides?: Partial<CapabilityListing>): CapabilityListing {
  return {
    capability: {
      capabilityId: 'cap://trust/test/v1',
      displayName: 'Trust Test',
      handlesIntents: ['intent.test'],
      intentLayers: ['L1'],
      provider: { id: 'prov-1', name: 'P1', trustScore: 0.8 },
      pricing: { model: 'free' },
      requiredPermissions: ['read'],
      endpoint: { protocol: 'in-process' },
      metadata: { version: '1.0.0', description: 'Trust test capability' },
    },
    registryMetadata: {
      category: 'development',
      tags: ['test'],
      publishedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    },
    status: 'active',
    ...overrides,
  };
}

describe('TrustEngine', () => {
  it('computes a score with all factors', () => {
    const engine = new TrustEngine();
    const listing = sampleListing();
    const result = engine.computeScore(listing, null, 30 * 24 * 60 * 60 * 1000);

    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(5);
    expect(result.lastUpdated).toBeGreaterThan(0);
  });

  it('boosts score for verified capabilities', () => {
    const engine = new TrustEngine();
    const unverified = sampleListing();
    const verified = sampleListing({
      registryMetadata: {
        category: 'development',
        tags: [],
        verification: { method: 'manual_review', status: 'verified', verifiedAt: Date.now(), verifierId: 'ver-1' },
        publishedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now(),
      },
    });

    const unvScore = engine.computeScore(unverified, null, 0);
    const vScore = engine.computeScore(verified, null, 0);

    expect(vScore.overall).toBeGreaterThan(unvScore.overall);
  });

  it('incorporates attestation scores', () => {
    const engine = new TrustEngine();
    const listing = sampleListing();

    const withoutAttestation = engine.computeScore(listing, null, 0);
    const withAttestation = engine.computeScore(
      listing,
      { capabilityId: 'cap://trust/test/v1', averageScore: 95, count: 5, lastAttestedAt: Date.now() },
      0,
    );

    expect(withAttestation.overall).toBeGreaterThan(withoutAttestation.overall);
  });

  it('provides detailed breakdown', () => {
    const engine = new TrustEngine();
    const listing = sampleListing();
    const breakdown = engine.getBreakdown('cap://trust/test/v1', listing, null, 0);

    expect(breakdown.capabilityId).toBe('cap://trust/test/v1');
    expect(breakdown.overall).toBeGreaterThan(0);
    expect(breakdown.baseScore).toBe(80);
    expect(breakdown.verificationScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.factorCount).toBe(5);
  });

  it('applies decay over time', () => {
    const engine = new TrustEngine();
    const recent = engine.applyDecay(100, Date.now());
    const old = engine.applyDecay(100, Date.now() - 30 * 24 * 60 * 60 * 1000);

    expect(recent).toBe(100);
    expect(old).toBeLessThan(100);
    expect(old).toBeGreaterThan(0);
  });

  it('applies multiple half-lives of decay', () => {
    const engine = new TrustEngine();
    const twoHalflives = engine.applyDecay(100, Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(twoHalflives).toBe(25);
  });
});
