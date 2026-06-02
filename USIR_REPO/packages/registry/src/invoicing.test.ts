import { describe, it, expect } from 'vitest';
import { PricingEngine } from './pricing-engine';
import { UsageTracker } from './usage-tracker';
import { MockPaymentProvider } from './payment-provider';
import { Invoicing } from './invoicing';
import type { CapabilityListing } from '@usir/protocol/capability';

function sampleListing(overrides?: Partial<CapabilityListing>): CapabilityListing {
  return {
    capability: {
      capabilityId: 'cap://inv/test/v1',
      displayName: 'Invoice Test',
      handlesIntents: ['intent.test'],
      intentLayers: ['L1'],
      provider: { id: 'prov-1', name: 'P1', trustScore: 0.8 },
      pricing: { model: 'per-call', costPerCall: 0.10 },
      requiredPermissions: ['read'],
      endpoint: { protocol: 'in-process' },
      metadata: { version: '1.0.0' },
    },
    registryMetadata: { category: 'development', tags: [], publishedAt: Date.now(), updatedAt: Date.now() },
    status: 'active',
    ...overrides,
  };
}

describe('Invoicing', () => {
  it('generates an invoice from usage', () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 50);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);

    expect(invoice.id).toMatch(/^inv_/);
    expect(invoice.lines.length).toBeGreaterThan(0);
    expect(invoice.total).toBeGreaterThan(0);
    expect(invoice.status).toBe('draft');
  });

  it('processes payment for an invoice', async () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 10);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);

    const { invoice: paid, result } = await invoicing.processPayment(invoice.id, 'pm_mock');
    expect(result.success).toBe(true);
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).toBeGreaterThan(0);
  });

  it('lists invoices by publisher and consumer', () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 10);
    invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);

    const byPublisher = invoicing.listInvoices('prov-1');
    expect(byPublisher).toHaveLength(1);

    const byConsumer = invoicing.listInvoices(undefined, 'consumer-1');
    expect(byConsumer).toHaveLength(1);

    const noMatch = invoicing.listInvoices('prov-other');
    expect(noMatch).toHaveLength(0);
  });

  it('creates checkout sessions', async () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 5);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);

    const session = await invoicing.createCheckoutSession(invoice.id);
    expect(session).not.toBeNull();
    expect(session!.invoiceId).toBe(invoice.id);
    expect(session!.status).toBe('pending');
  });

  it('computes publisher payouts', () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 20);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);
    invoice.status = 'paid';
    invoice.paidAt = now;

    const payout = invoicing.computePayout('prov-1', now - 5000, now + 5000);
    expect(payout.invoiceCount).toBe(1);
    expect(payout.amount).toBeGreaterThan(0);
    expect(payout.status).toBe('pending');
  });

  it('schedules and processes payouts', async () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 10);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);
    invoice.status = 'paid';
    invoice.paidAt = now;

    const payout = invoicing.computePayout('prov-1', now - 5000, now + 5000);
    const scheduled = invoicing.schedulePayout(payout.id);
    expect(scheduled!.status).toBe('scheduled');

    const processed = await invoicing.processPayout(payout.id, 'pm_mock');
    expect(processed!.status).toBe('paid');
  });

  it('marks overdue invoices', () => {
    const pricing = new PricingEngine();
    const usage = new UsageTracker();
    const payment = new MockPaymentProvider();
    const invoicing = new Invoicing(pricing, usage, payment);

    const now = Date.now();
    usage.recordUsage('cap://inv/test/v1', 'prov-1', 'consumer-1', 1);
    const invoice = invoicing.generateInvoice(sampleListing(), 'consumer-1', now - 1000, now + 1000);
    invoice.status = 'sent';
    invoice.issuedAt = now - 40 * 24 * 60 * 60 * 1000;

    const count = invoicing.markOverdue();
    expect(count).toBe(1);
    expect(invoice.status).toBe('overdue');
  });
});
