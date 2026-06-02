import { describe, it, expect } from 'vitest';
import { PricingEngine } from './pricing-engine';
import type { Capability, UsageAggregate, RateCard } from '@usir/protocol/capability';

function sampleCap(overrides?: Partial<Capability>): Capability {
  return {
    capabilityId: 'cap://price/test/v1',
    displayName: 'Price Test',
    handlesIntents: ['intent.test'],
    intentLayers: ['L1'],
    provider: { id: 'prov-1', name: 'P1', trustScore: 0.8 },
    pricing: { model: 'free' },
    requiredPermissions: ['read'],
    endpoint: { protocol: 'in-process' },
    metadata: { version: '1.0.0' },
    ...overrides,
  };
}

function usage(quantity: number): UsageAggregate {
  return {
    capabilityId: 'cap://price/test/v1',
    publisherId: 'pub-1',
    totalQuantity: quantity,
    recordCount: 1,
    periodStart: Date.now() - 1000,
    periodEnd: Date.now(),
  };
}

describe('PricingEngine', () => {
  it('returns zero-cost lines for free model', () => {
    const engine = new PricingEngine();
    const lines = engine.computeInvoiceLines(sampleCap(), usage(100));
    expect(lines).toHaveLength(1);
    expect(lines[0].total).toBe(0);
  });

  it('computes per-call pricing', () => {
    const engine = new PricingEngine();
    engine.setRateCard({
      capabilityId: 'cap://price/test/v1',
      model: 'per-call',
      currency: 'USD',
      perCallCost: 0.05,
    });
    const lines = engine.computeInvoiceLines(sampleCap({ pricing: { model: 'per-call', costPerCall: 0.05 } }), usage(100));
    expect(lines[0].total).toBe(5);
    expect(lines[0].quantity).toBe(100);
  });

  it('computes metered pricing with tiers', () => {
    const engine = new PricingEngine();
    const card: RateCard = {
      capabilityId: 'cap://price/test/v1',
      model: 'metered',
      currency: 'USD',
      meteredUnit: 'token',
      tiers: [
        { fromUnits: 0, toUnits: 1000, costPerUnit: 0.01 },
        { fromUnits: 1001, toUnits: null, costPerUnit: 0.005 },
      ],
    };
    engine.setRateCard(card);
    const lines = engine.computeInvoiceLines(sampleCap({ pricing: { model: 'metered' } }), usage(3000));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const total = lines.reduce((s, l) => s + l.total, 0);
    expect(total).toBeCloseTo(20.01, 2);
  });

  it('computes subscription pricing', () => {
    const engine = new PricingEngine();
    engine.setRateCard({
      capabilityId: 'cap://price/test/v1',
      model: 'subscription',
      currency: 'USD',
      subscriptionCost: 9.99,
      subscriptionInterval: 'monthly',
    });
    const lines = engine.computeInvoiceLines(sampleCap({ pricing: { model: 'subscription' } }), usage(0));
    expect(lines[0].total).toBe(9.99);
    expect(lines[0].quantity).toBe(1);
  });

  it('returns null for missing rate card', () => {
    const engine = new PricingEngine();
    expect(engine.getRateCard('nonexistent')).toBeNull();
  });
});
