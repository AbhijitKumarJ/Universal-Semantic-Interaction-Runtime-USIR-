import { describe, it, expect } from 'vitest';
import { ReputationOracle } from './reputation-oracle';
import type { Attestation } from '@usir/protocol/capability';

function makeAttestation(overrides?: Partial<Attestation>): Attestation {
  return {
    id: 'att-1',
    capabilityId: 'cap://oracle/test/v1',
    attestorId: 'peer-1',
    score: 85,
    attestedAt: Date.now(),
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe('ReputationOracle', () => {
  it('stores and retrieves attestations', () => {
    const oracle = new ReputationOracle();
    oracle.submitAttestation(makeAttestation());

    const list = oracle.getAttestations('cap://oracle/test/v1');
    expect(list).toHaveLength(1);
    expect(list[0].score).toBe(85);
  });

  it('computes aggregate score across attestations', () => {
    const oracle = new ReputationOracle();
    oracle.submitAttestation(makeAttestation({ id: 'att-1', attestorId: 'peer-1', score: 80 }));
    oracle.submitAttestation(makeAttestation({ id: 'att-2', attestorId: 'peer-2', score: 90 }));

    const agg = oracle.getAggregate('cap://oracle/test/v1');
    expect(agg).not.toBeNull();
    expect(agg!.averageScore).toBe(85);
    expect(agg!.count).toBe(2);
  });

  it('replaces existing attestation from same attestor', () => {
    const oracle = new ReputationOracle();
    oracle.submitAttestation(makeAttestation({ id: 'att-1', attestorId: 'peer-1', score: 50 }));
    oracle.submitAttestation(makeAttestation({ id: 'att-2', attestorId: 'peer-1', score: 95 }));

    const agg = oracle.getAggregate('cap://oracle/test/v1');
    expect(agg!.averageScore).toBe(95);
    expect(agg!.count).toBe(1);
  });

  it('ignores expired attestations', () => {
    const oracle = new ReputationOracle();
    oracle.submitAttestation(makeAttestation({ id: 'att-1', expiresAt: Date.now() - 1000 }));
    oracle.submitAttestation(makeAttestation({ id: 'att-2', attestorId: 'peer-2', score: 90 }));

    const list = oracle.getAttestations('cap://oracle/test/v1');
    expect(list).toHaveLength(1);
  });

  it('returns null for capabilities with no attestations', () => {
    const oracle = new ReputationOracle();
    expect(oracle.getAggregate('nonexistent')).toBeNull();
  });

  it('pruneExpired handles empty state gracefully', () => {
    const oracle = new ReputationOracle();
    expect(oracle.pruneExpired()).toBe(0);
  });

  it('expired attestations are rejected on submit', () => {
    const oracle = new ReputationOracle();
    oracle.submitAttestation(makeAttestation({ id: 'att-1', expiresAt: Date.now() - 1000 }));
    expect(oracle.getAttestations('cap://oracle/test/v1')).toHaveLength(0);
  });
});
