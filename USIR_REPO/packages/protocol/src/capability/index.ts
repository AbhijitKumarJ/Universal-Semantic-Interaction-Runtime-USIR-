/**
 * Capability Marketplace — the long-term endgame.
 *
 * Instead of an App Store, USIR envisions a Capability Market where
 * intent handlers are dynamic services discovered, priced, and invoked
 * at runtime. This module defines the discovery + invocation protocol.
 *
 * (This is a forward-looking addition from the USIR Review's "Semantic
 * Economics" section. The MVP doesn't need to implement it, but the
 * types should be defined so the runtime can reason about capabilities.)
 */

import type { BaseIntent, IntentLayer } from '../intents';

/**
 * A capability is a serverless-like handler that can execute a class of intents.
 * Discovery is via the @usir/runtime, invocation is by name + version.
 */
export interface Capability {
  /** Globally unique capability id, e.g. "capability://translation/deepl/v1" */
  capabilityId: string;
  /** Human-readable name (e.g. "DeepL Translation") */
  displayName: string;
  /** What kinds of intent this capability handles */
  handlesIntents: Array<BaseIntent['type']>;
  /** Which intent layers it covers (L1-L8) */
  intentLayers: IntentLayer[];
  /** Provider info */
  provider: {
    id: string;
    name: string;
    /** Trust score 0-1 based on historical execution success */
    trustScore: number;
  };
  /** Pricing model */
  pricing: {
    model: 'free' | 'per-call' | 'subscription' | 'metered';
    costPerCall?: number;
    currency?: string;
  };
  /** Required permissions on the user's semantic graph */
  requiredPermissions: Array<'read' | 'write' | 'delegate' | 'share'>;
  /** Where to invoke it */
  endpoint: {
    protocol: 'http' | 'grpc' | 'wasm' | 'in-process';
    url?: string;
  };
  /** Optional capability metadata */
  metadata: {
    version: string;
    description?: string;
    documentationUrl?: string;
    schemaUrl?: string;
  };
}

/**
 * A capability registry — the runtime's local cache of discovered capabilities.
 */
export interface CapabilityRegistry {
  capabilities: Map<string, Capability>;
  /** Index by handled intent type for fast lookup */
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
