import type { Attestation, AttestationAggregate } from '@usir/protocol/capability';

export interface OracleConfig {
  attestationExpiryMs: number;
  minAttestations: number;
}

export class ReputationOracle {
  private attestations = new Map<string, Attestation[]>();
  private aggregates = new Map<string, AttestationAggregate>();
  private config: OracleConfig;

  constructor(config?: Partial<OracleConfig>) {
    this.config = {
      attestationExpiryMs: config?.attestationExpiryMs ?? 90 * 24 * 60 * 60 * 1000,
      minAttestations: config?.minAttestations ?? 1,
    };
  }

  submitAttestation(attestation: Attestation): void {
    if (Date.now() > attestation.expiresAt) return;

    if (!this.attestations.has(attestation.capabilityId)) {
      this.attestations.set(attestation.capabilityId, []);
    }
    const list = this.attestations.get(attestation.capabilityId)!;
    const existing = list.findIndex((a) => a.attestorId === attestation.attestorId);
    if (existing >= 0) {
      list[existing] = attestation;
    } else {
      list.push(attestation);
    }

    this.recomputeAggregate(attestation.capabilityId);
  }

  getAttestations(capabilityId: string): Attestation[] {
    const list = this.attestations.get(capabilityId) ?? [];
    return list.filter((a) => Date.now() <= a.expiresAt);
  }

  getAggregate(capabilityId: string): AttestationAggregate | null {
    if (!this.aggregates.has(capabilityId)) {
      this.recomputeAggregate(capabilityId);
    }
    const agg = this.aggregates.get(capabilityId);
    if (!agg || agg.count < this.config.minAttestations) return null;
    return agg;
  }

  get allAggregates(): Map<string, AttestationAggregate> {
    return new Map(this.aggregates);
  }

  pruneExpired(): number {
    let pruned = 0;
    for (const [capId, list] of this.attestations) {
      const before = list.length;
      this.attestations.set(capId, list.filter((a) => Date.now() <= a.expiresAt));
      pruned += before - this.attestations.get(capId)!.length;
      this.recomputeAggregate(capId);
    }
    return pruned;
  }

  private recomputeAggregate(capabilityId: string): void {
    const valid = this.getAttestations(capabilityId);
    if (valid.length === 0) {
      this.aggregates.delete(capabilityId);
      return;
    }
    const sum = valid.reduce((s, a) => s + a.score, 0);
    const maxTime = Math.max(...valid.map((a) => a.attestedAt));
    this.aggregates.set(capabilityId, {
      capabilityId,
      averageScore: Math.round(sum / valid.length),
      count: valid.length,
      lastAttestedAt: maxTime,
    });
  }
}
