import type { CapabilityListing, AttestationAggregate, TrustScore, TrustFactor, TrustScoreBreakdown, TrustDecayConfig } from '@usir/protocol/capability';
import { TRUST_WEIGHTS, DEFAULT_DECAY_CONFIG } from '@usir/protocol/capability';

export interface TrustEngineConfig {
  decayConfig: TrustDecayConfig;
}

export class TrustEngine {
  private config: TrustEngineConfig;

  constructor(config?: Partial<TrustEngineConfig>) {
    this.config = {
      decayConfig: config?.decayConfig ?? DEFAULT_DECAY_CONFIG,
    };
  }

  computeScore(
    listing: CapabilityListing,
    attestations: AttestationAggregate | null,
    uptimeMs: number,
  ): TrustScore {
    const baseScore = listing.capability.provider.trustScore * 100;
    const verificationScore = this.verificationBonus(listing);
    const attestationScore = attestations?.averageScore ?? 50;
    const uptimeScore = this.uptimeScore(uptimeMs);
    const recencyScore = this.recencyScore(listing.registryMetadata.updatedAt);

    const factors: TrustFactor[] = [
      { name: 'base', weight: TRUST_WEIGHTS.base, score: baseScore, source: 'provider' },
      { name: 'verification', weight: TRUST_WEIGHTS.verification, score: verificationScore, source: 'registry' },
      { name: 'attestation', weight: TRUST_WEIGHTS.attestation, score: attestationScore, source: attestations ? `peers (${attestations.count})` : 'default' },
      { name: 'uptime', weight: TRUST_WEIGHTS.uptime, score: uptimeScore, source: 'registry' },
      { name: 'recency', weight: TRUST_WEIGHTS.recency, score: recencyScore, source: 'registry' },
    ];

    const overall = Math.round(
      factors.reduce((sum, f) => sum + f.score * f.weight, 0),
    );

    return {
      overall: Math.min(100, Math.max(0, overall)),
      factors,
      lastUpdated: Date.now(),
    };
  }

  getBreakdown(
    capabilityId: string,
    listing: CapabilityListing,
    attestations: AttestationAggregate | null,
    uptimeMs: number,
  ): TrustScoreBreakdown {
    const trust = this.computeScore(listing, attestations, uptimeMs);
    const baseFactor = trust.factors.find((f) => f.name === 'base')!;
    const verifFactor = trust.factors.find((f) => f.name === 'verification')!;
    const attestFactor = trust.factors.find((f) => f.name === 'attestation')!;
    const uptimeFactor = trust.factors.find((f) => f.name === 'uptime')!;
    const recencyFactor = trust.factors.find((f) => f.name === 'recency')!;

    return {
      capabilityId,
      overall: trust.overall,
      baseScore: Math.round(baseFactor.score),
      verificationScore: Math.round(verifFactor.score),
      attestationScore: Math.round(attestFactor.score),
      uptimeScore: Math.round(uptimeFactor.score),
      recencyScore: Math.round(recencyFactor.score),
      factorCount: trust.factors.length,
      lastUpdated: trust.lastUpdated,
    };
  }

  applyDecay(score: number, lastActivity: number): number {
    const elapsed = Date.now() - lastActivity;
    if (elapsed <= 0) return score;
    const halfLives = elapsed / this.config.decayConfig.halfLifeMs;
    return Math.round(score * Math.pow(0.5, halfLives));
  }

  private verificationBonus(listing: CapabilityListing): number {
    const v = listing.registryMetadata.verification;
    if (!v) return 0;
    switch (v.status) {
      case 'verified': return 100;
      case 'pending': return 60;
      case 'unverified': return 30;
      default: return 0;
    }
  }

  private uptimeScore(uptimeMs: number): number {
    const days = uptimeMs / (24 * 60 * 60 * 1000);
    if (days >= 90) return 100;
    if (days >= 30) return 80;
    if (days >= 7) return 60;
    if (days >= 1) return 40;
    return 20;
  }

  private recencyScore(lastUpdated: number): number {
    const elapsed = Date.now() - lastUpdated;
    const days = elapsed / (24 * 60 * 60 * 1000);
    if (days <= 1) return 100;
    if (days <= 7) return 80;
    if (days <= 30) return 60;
    if (days <= 90) return 40;
    return 20;
  }
}
