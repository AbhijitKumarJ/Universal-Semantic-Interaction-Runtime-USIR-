import type { Capability, CapabilityListing } from '@usir/protocol/capability';
import type { BaseIntent } from '@usir/protocol/intents';
import { createCapabilityRegistry, registerCapability, findCapabilities } from '@usir/protocol/capability';
import type { RegistryClient } from './registry-client';

export interface CacheConfig {
  maxAgeMs: number;
}

export class LocalCapabilityCache {
  private registry = createCapabilityRegistry();
  private listings = new Map<string, CapabilityListing>();
  private lastSync = 0;
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { maxAgeMs: config?.maxAgeMs ?? 300_000 };
  }

  get capabilities(): Map<string, Capability> {
    return this.registry.capabilities;
  }

  get listingCount(): number {
    return this.listings.size;
  }

  get isStale(): boolean {
    return Date.now() - this.lastSync > this.config.maxAgeMs;
  }

  findCapabilities(intentType: BaseIntent['type']): Capability[] {
    return findCapabilities(this.registry, intentType);
  }

  getListing(id: string): CapabilityListing | undefined {
    return this.listings.get(id);
  }

  async sync(client: RegistryClient): Promise<void> {
    const result = await client.search({ limit: 200 });
    this.applySyncResult(result.items);
  }

  async syncDelta(client: RegistryClient, since?: number): Promise<void> {
    const result = await client.search({ limit: 200 });
    this.applySyncResult(result.items);
  }

  updateFromListing(listing: CapabilityListing): void {
    this.listings.set(listing.capability.capabilityId, listing);
    registerCapability(this.registry, listing.capability);
    this.lastSync = Date.now();
  }

  remove(id: string): void {
    this.listings.delete(id);
    this.registry.capabilities.delete(id);
    for (const [, ids] of this.registry.byIntentType) {
      const idx = ids.indexOf(id);
      if (idx >= 0) ids.splice(idx, 1);
    }
  }

  clear(): void {
    this.registry = createCapabilityRegistry();
    this.listings.clear();
    this.lastSync = 0;
  }

  private applySyncResult(items: CapabilityListing[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.capability.capabilityId);
      this.updateFromListing(item);
    }
    for (const [id] of this.listings) {
      if (!seen.has(id)) {
        this.remove(id);
      }
    }
    this.lastSync = Date.now();
  }
}
