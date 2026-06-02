export interface TrustFactor {
  name: string;
  weight: number;
  score: number;
  source: string;
}

export interface TrustScore {
  overall: number;
  factors: TrustFactor[];
  lastUpdated: number;
}

export interface TrustDecayConfig {
  halfLifeMs: number;
}

export interface Attestation {
  id: string;
  capabilityId: string;
  attestorId: string;
  score: number;
  comment?: string;
  attestedAt: number;
  expiresAt: number;
}

export interface AttestationAggregate {
  capabilityId: string;
  averageScore: number;
  count: number;
  lastAttestedAt: number;
}

export interface TrustScoreBreakdown {
  capabilityId: string;
  overall: number;
  baseScore: number;
  verificationScore: number;
  attestationScore: number;
  uptimeScore: number;
  recencyScore: number;
  factorCount: number;
  lastUpdated: number;
}

export const DEFAULT_DECAY_CONFIG: TrustDecayConfig = {
  halfLifeMs: 30 * 24 * 60 * 60 * 1000,
};

export const TRUST_WEIGHTS = {
  base: 0.3,
  verification: 0.2,
  attestation: 0.25,
  uptime: 0.15,
  recency: 0.1,
};
