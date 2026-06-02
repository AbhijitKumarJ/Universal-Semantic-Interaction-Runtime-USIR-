import { describe, it, expect } from 'vitest';
import { UsageTracker } from './usage-tracker';

describe('UsageTracker', () => {
  it('records capability usage', () => {
    const tracker = new UsageTracker();
    const record = tracker.recordUsage('cap://test/v1', 'pub-1', 'consumer-1', 5);
    expect(record.capabilityId).toBe('cap://test/v1');
    expect(record.quantity).toBe(5);
    expect(record.id).toMatch(/^usage-/);
  });

  it('aggregates usage by capability within a period', () => {
    const tracker = new UsageTracker();
    const now = Date.now();
    tracker.recordUsage('cap://test/v1', 'pub-1', 'consumer-1', 3);
    tracker.recordUsage('cap://test/v1', 'pub-1', 'consumer-1', 7);

    const agg = tracker.getUsage('cap://test/v1', now - 1000, now + 1000);
    expect(agg.totalQuantity).toBe(10);
    expect(agg.recordCount).toBe(2);
  });

  it('excludes records outside the period', () => {
    const tracker = new UsageTracker();
    tracker.recordUsage('cap://test/v1', 'pub-1', 'consumer-1', 5);
    const agg = tracker.getUsage('cap://test/v1', Date.now() + 10000, Date.now() + 20000);
    expect(agg.totalQuantity).toBe(0);
    expect(agg.recordCount).toBe(0);
  });

  it('aggregates by publisher', () => {
    const tracker = new UsageTracker();
    const now = Date.now();
    tracker.recordUsage('cap://a/v1', 'pub-1', 'consumer-1', 10);
    tracker.recordUsage('cap://b/v1', 'pub-1', 'consumer-1', 20);
    tracker.recordUsage('cap://c/v1', 'pub-2', 'consumer-1', 30);

    const pubAggs = tracker.getUsageByPublisher('pub-1', now - 1000, now + 1000);
    expect(pubAggs).toHaveLength(2);
    expect(pubAggs[0].totalQuantity).toBe(10);
    expect(pubAggs[1].totalQuantity).toBe(20);
  });

  it('aggregates by consumer', () => {
    const tracker = new UsageTracker();
    const now = Date.now();
    tracker.recordUsage('cap://a/v1', 'pub-1', 'consumer-1', 5);
    tracker.recordUsage('cap://a/v1', 'pub-1', 'consumer-2', 15);

    const consumerAggs = tracker.getUsageByConsumer('consumer-1', now - 1000, now + 1000);
    expect(consumerAggs).toHaveLength(1);
    expect(consumerAggs[0].totalQuantity).toBe(5);
  });
});
