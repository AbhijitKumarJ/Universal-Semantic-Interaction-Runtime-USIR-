import type { BaseIntent, IntentLayer } from '../intents';

export interface Capability {
  capabilityId: string;
  displayName: string;
  handlesIntents: Array<BaseIntent['type']>;
  intentLayers: IntentLayer[];
  provider: {
    id: string;
    name: string;
    trustScore: number;
  };
  pricing: {
    model: 'free' | 'per-call' | 'subscription' | 'metered';
    costPerCall?: number;
    currency?: string;
  };
  requiredPermissions: Array<'read' | 'write' | 'delegate' | 'share'>;
  endpoint: {
    protocol: 'http' | 'grpc' | 'wasm' | 'in-process';
    url?: string;
  };
  metadata: {
    version: string;
    description?: string;
    documentationUrl?: string;
    schemaUrl?: string;
  };
}

export type CapabilityCategory =
  | 'translation'
  | 'productivity'
  | 'communication'
  | 'development'
  | 'data'
  | 'media'
  | 'automation'
  | 'iot'
  | 'xr'
  | 'system'
  | 'other';

export interface RegistryMetadata {
  category: CapabilityCategory;
  tags: string[];
  verification?: {
    method: 'signature' | 'manual_review' | 'automated';
    status: 'verified' | 'pending' | 'unverified';
    verifiedAt?: number;
    verifierId?: string;
  };
  publishedAt: number;
  updatedAt: number;
}

export type ListingStatus = 'active' | 'deprecated' | 'removed';

export interface CapabilityListing {
  capability: Capability;
  registryMetadata: RegistryMetadata;
  status: ListingStatus;
}

export interface PublisherIdentity {
  publisherId: string;
  name: string;
  publicKey: string;
}

export interface RegistrySearchQuery {
  query?: string;
  category?: CapabilityCategory;
  tags?: string[];
  intentType?: string;
  minTrustScore?: number;
  status?: ListingStatus;
  offset?: number;
  limit?: number;
}

export interface RegistrySearchResult {
  items: CapabilityListing[];
  total: number;
  offset: number;
  limit: number;
}

export interface RegistryStats {
  totalCapabilities: number;
  totalPublishers: number;
  categories: Record<string, number>;
  averageTrustScore: number;
  uptime: number;
}

export interface CapabilityRegistry {
  capabilities: Map<string, Capability>;
  byIntentType: Map<BaseIntent['type'], string[]>;
  lastRefresh: number;
}

export function createCapabilityRegistry(): CapabilityRegistry {
  return {
    capabilities: new Map(),
    byIntentType: new Map(),
    lastRefresh: 0,
  };
}

export function registerCapability(registry: CapabilityRegistry, cap: Capability): void {
  registry.capabilities.set(cap.capabilityId, cap);
  for (const intentType of cap.handlesIntents) {
    if (!registry.byIntentType.has(intentType)) {
      registry.byIntentType.set(intentType, []);
    }
    registry.byIntentType.get(intentType)!.push(cap.capabilityId);
  }
  registry.lastRefresh = Date.now();
}

export function findCapabilities(registry: CapabilityRegistry, intentType: BaseIntent['type']): Capability[] {
  const ids = registry.byIntentType.get(intentType) ?? [];
  return ids.map((id) => registry.capabilities.get(id)!).filter(Boolean);
}

export function createCapabilityListing(cap: Capability, category: CapabilityCategory, tags?: string[]): CapabilityListing {
  const now = Date.now();
  return {
    capability: cap,
    registryMetadata: {
      category,
      tags: tags ?? [],
      verification: {
        method: 'automated',
        status: 'unverified',
      },
      publishedAt: now,
      updatedAt: now,
    },
    status: 'active',
  };
}

export * from './trust-types';
export * from './pricing-types';
