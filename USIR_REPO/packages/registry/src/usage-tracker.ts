import type { UsageRecord, UsageAggregate } from '@usir/protocol/capability';

export class UsageTracker {
  private records: UsageRecord[] = [];
  private idCounter = 0;

  recordUsage(capabilityId: string, publisherId: string, consumerId: string, quantity: number): UsageRecord {
    const record: UsageRecord = {
      id: `usage-${++this.idCounter}`,
      capabilityId,
      publisherId,
      consumerId,
      quantity,
      timestamp: Date.now(),
    };
    this.records.push(record);
    return record;
  }

  getUsage(
    capabilityId: string,
    periodStart: number,
    periodEnd: number,
  ): UsageAggregate {
    const matching = this.records.filter(
      (r) =>
        r.capabilityId === capabilityId &&
        r.timestamp >= periodStart &&
        r.timestamp <= periodEnd,
    );
    return {
      capabilityId,
      publisherId: matching[0]?.publisherId ?? '',
      totalQuantity: matching.reduce((s, r) => s + r.quantity, 0),
      recordCount: matching.length,
      periodStart,
      periodEnd,
    };
  }

  getUsageByPublisher(
    publisherId: string,
    periodStart: number,
    periodEnd: number,
  ): UsageAggregate[] {
    const byCapability = new Map<string, UsageRecord[]>();
    for (const r of this.records) {
      if (r.publisherId === publisherId && r.timestamp >= periodStart && r.timestamp <= periodEnd) {
        if (!byCapability.has(r.capabilityId)) {
          byCapability.set(r.capabilityId, []);
        }
        byCapability.get(r.capabilityId)!.push(r);
      }
    }
    return Array.from(byCapability.entries()).map(([capId, recs]) => ({
      capabilityId: capId,
      publisherId,
      totalQuantity: recs.reduce((s, r) => s + r.quantity, 0),
      recordCount: recs.length,
      periodStart,
      periodEnd,
    }));
  }

  getUsageByConsumer(
    consumerId: string,
    periodStart: number,
    periodEnd: number,
  ): UsageAggregate[] {
    const byCapability = new Map<string, UsageRecord[]>();
    for (const r of this.records) {
      if (r.consumerId === consumerId && r.timestamp >= periodStart && r.timestamp <= periodEnd) {
        if (!byCapability.has(r.capabilityId)) {
          byCapability.set(r.capabilityId, []);
        }
        byCapability.get(r.capabilityId)!.push(r);
      }
    }
    return Array.from(byCapability.entries()).map(([capId, recs]) => ({
      capabilityId: capId,
      publisherId: recs[0].publisherId,
      totalQuantity: recs.reduce((s, r) => s + r.quantity, 0),
      recordCount: recs.length,
      periodStart,
      periodEnd,
    }));
  }

  clear(): void {
    this.records = [];
    this.idCounter = 0;
  }
}
