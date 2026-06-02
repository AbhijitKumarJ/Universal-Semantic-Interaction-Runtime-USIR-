import type { Capability, CapabilityCategory, RegistrySearchQuery, RegistrySearchResult, CapabilityListing, ListingStatus, RegistryStats, PublisherIdentity } from '@usir/protocol/capability';
import { createCapabilityListing } from '@usir/protocol/capability';
import type { IncomingMessage } from 'http';

export interface StoredListing {
  listing: CapabilityListing;
  publisher: PublisherIdentity;
  signature?: string;
}

export class RegistryStore {
  private listings = new Map<string, StoredListing>();
  private publishers = new Map<string, PublisherIdentity>();
  private categoryIndex = new Map<CapabilityCategory, string[]>();
  private tagIndex = new Map<string, string[]>();
  private intentIndex = new Map<string, string[]>();
  private startTime = Date.now();

  publish(
    capability: Capability,
    category: CapabilityCategory,
    publisher: PublisherIdentity,
    tags?: string[],
    signature?: string,
  ): CapabilityListing {
    const existing = this.listings.get(capability.capabilityId);
    const now = Date.now();
    const listing: CapabilityListing = existing
      ? {
          capability,
          registryMetadata: {
            ...existing.listing.registryMetadata,
            category,
            tags: tags ?? existing.listing.registryMetadata.tags,
            updatedAt: now,
          },
          status: 'active',
        }
      : createCapabilityListing(capability, category, tags);

    this.listings.set(capability.capabilityId, { listing, publisher, signature });
    this.publishers.set(publisher.publisherId, publisher);

    this.addToCategoryIndex(capability.capabilityId, category);
    for (const tag of listing.registryMetadata.tags) {
      this.addToTagIndex(capability.capabilityId, tag);
    }
    for (const intentType of capability.handlesIntents) {
      this.addToIntentIndex(capability.capabilityId, intentType);
    }

    return listing;
  }

  get(capabilityId: string): StoredListing | undefined {
    return this.listings.get(capabilityId);
  }

  getListing(capabilityId: string): CapabilityListing | undefined {
    return this.listings.get(capabilityId)?.listing;
  }

  unpublish(capabilityId: string): boolean {
    const stored = this.listings.get(capabilityId);
    if (!stored) return false;
    stored.listing.status = 'removed';
    stored.listing.registryMetadata.updatedAt = Date.now();
    return true;
  }

  delete(capabilityId: string): boolean {
    const stored = this.listings.get(capabilityId);
    if (!stored) return false;
    this.removeFromIndexes(capabilityId, stored);
    this.listings.delete(capabilityId);
    return true;
  }

  search(query: RegistrySearchQuery): RegistrySearchResult {
    let results = Array.from(this.listings.values()).map((s) => s.listing);

    if (query.status) {
      results = results.filter((l) => l.status === query.status);
    } else {
      results = results.filter((l) => l.status === 'active');
    }

    if (query.category) {
      results = results.filter((l) => l.registryMetadata.category === query.category);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((l) =>
        query.tags!.some((t) => l.registryMetadata.tags.includes(t)),
      );
    }

    if (query.intentType) {
      results = results.filter((l) =>
        l.capability.handlesIntents.includes(query.intentType as any),
      );
    }

    if (query.minTrustScore !== undefined) {
      results = results.filter(
        (l) => l.capability.provider.trustScore >= query.minTrustScore!,
      );
    }

    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(
        (l) =>
          l.capability.displayName.toLowerCase().includes(q) ||
          l.capability.capabilityId.toLowerCase().includes(q) ||
          l.capability.metadata.description?.toLowerCase().includes(q) ||
          l.capability.provider.name.toLowerCase().includes(q),
      );
    }

    results.sort((a, b) => b.capability.provider.trustScore - a.capability.provider.trustScore);

    const total = results.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const items = results.slice(offset, offset + limit);

    return { items, total, offset, limit };
  }

  getStats(): RegistryStats {
    const totalCapabilities = this.listings.size;
    const totalPublishers = this.publishers.size;
    const categories: Record<string, number> = {};
    let trustSum = 0;
    let trustCount = 0;

    for (const [, stored] of this.listings) {
      const cat = stored.listing.registryMetadata.category;
      categories[cat] = (categories[cat] ?? 0) + 1;
      trustSum += stored.listing.capability.provider.trustScore;
      trustCount++;
    }

    return {
      totalCapabilities,
      totalPublishers,
      categories,
      averageTrustScore: trustCount > 0 ? trustSum / trustCount : 0,
      uptime: Date.now() - this.startTime,
    };
  }

  getPublishers(): PublisherIdentity[] {
    return Array.from(this.publishers.values());
  }

  listByPublisher(publisherId: string): CapabilityListing[] {
    return Array.from(this.listings.values())
      .filter((s) => s.publisher.publisherId === publisherId)
      .map((s) => s.listing);
  }

  private addToCategoryIndex(id: string, category: CapabilityCategory): void {
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, []);
    }
    this.categoryIndex.get(category)!.push(id);
  }

  private addToTagIndex(id: string, tag: string): void {
    if (!this.tagIndex.has(tag)) {
      this.tagIndex.set(tag, []);
    }
    this.tagIndex.get(tag)!.push(id);
  }

  private addToIntentIndex(id: string, intentType: string): void {
    if (!this.intentIndex.has(intentType)) {
      this.intentIndex.set(intentType, []);
    }
    this.intentIndex.get(intentType)!.push(id);
  }

  private removeFromIndexes(id: string, stored: StoredListing): void {
    const cat = stored.listing.registryMetadata.category;
    const catList = this.categoryIndex.get(cat);
    if (catList) {
      const idx = catList.indexOf(id);
      if (idx >= 0) catList.splice(idx, 1);
    }
    for (const tag of stored.listing.registryMetadata.tags) {
      const tagList = this.tagIndex.get(tag);
      if (tagList) {
        const idx = tagList.indexOf(id);
        if (idx >= 0) tagList.splice(idx, 1);
      }
    }
    for (const intentType of stored.listing.capability.handlesIntents) {
      const intentList = this.intentIndex.get(intentType);
      if (intentList) {
        const idx = intentList.indexOf(id);
        if (idx >= 0) intentList.splice(idx, 1);
      }
    }
  }
}
