import type { CapabilityListing, UsageAggregate, RateCard, Invoice, InvoiceLine, InvoiceStatus, Payout, CheckoutSession } from '@usir/protocol/capability';
import type { PricingEngine } from './pricing-engine';
import type { UsageTracker } from './usage-tracker';
import type { PaymentProvider, PaymentResult } from './payment-provider';

export class Invoicing {
  private invoices: Map<string, Invoice> = new Map();
  private payouts: Map<string, Payout> = new Map();
  private checkoutSessions: Map<string, CheckoutSession> = new Map();
  private pricingEngine: PricingEngine;
  private usageTracker: UsageTracker;
  private paymentProvider: PaymentProvider;
  private idCounter = 0;
  private payoutIdCounter = 0;

  constructor(
    pricingEngine: PricingEngine,
    usageTracker: UsageTracker,
    paymentProvider: PaymentProvider,
  ) {
    this.pricingEngine = pricingEngine;
    this.usageTracker = usageTracker;
    this.paymentProvider = paymentProvider;
  }

  generateInvoice(
    listing: CapabilityListing,
    consumerId: string,
    periodStart: number,
    periodEnd: number,
  ): Invoice {
    const usage = this.usageTracker.getUsage(listing.capability.capabilityId, periodStart, periodEnd);
    const lines = this.pricingEngine.computeInvoiceLines(listing.capability, usage);
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * 0.08);
    const total = subtotal + tax;
    const card = this.pricingEngine.getRateCard(listing.capability.capabilityId);

    const invoice: Invoice = {
      id: `inv_${++this.idCounter}`,
      publisherId: listing.capability.provider.id,
      consumerId,
      periodStart,
      periodEnd,
      lines,
      subtotal,
      tax,
      total,
      currency: card?.currency ?? 'USD',
      status: 'draft',
      issuedAt: Date.now(),
    };

    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  getInvoice(id: string): Invoice | null {
    return this.invoices.get(id) ?? null;
  }

  listInvoices(publisherId?: string, consumerId?: string): Invoice[] {
    return Array.from(this.invoices.values()).filter((inv) => {
      if (publisherId && inv.publisherId !== publisherId) return false;
      if (consumerId && inv.consumerId !== consumerId) return false;
      return true;
    });
  }

  async sendInvoice(invoiceId: string): Promise<Invoice | null> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return null;
    inv.status = 'sent';
    return inv;
  }

  async processPayment(invoiceId: string, paymentMethodId: string): Promise<{ invoice: Invoice; result: PaymentResult }> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new Error(`Invoice ${invoiceId} not found`);

    const result = await this.paymentProvider.processPayment(invoiceId, inv.total, inv.currency, paymentMethodId);
    if (result.success) {
      inv.status = 'paid';
      inv.paidAt = Date.now();
    }
    return { invoice: inv, result };
  }

  async createCheckoutSession(invoiceId: string): Promise<CheckoutSession | null> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return null;

    const session = await this.paymentProvider.createCheckout({
      invoiceId,
      amount: inv.total,
      currency: inv.currency,
    });

    this.checkoutSessions.set(session.id, session);
    return session;
  }

  getCheckoutSession(id: string): CheckoutSession | null {
    return this.checkoutSessions.get(id) ?? null;
  }

  computePayout(publisherId: string, periodStart: number, periodEnd: number): Payout {
    const paidInvoices = this.listInvoices(publisherId).filter(
      (inv) => inv.status === 'paid' && inv.paidAt && inv.paidAt >= periodStart && inv.paidAt <= periodEnd,
    );

    const totalEarnings = paidInvoices.reduce((s, inv) => s + inv.total, 0);
    const platformFee = Math.round(totalEarnings * 0.1);
    const payout = totalEarnings - platformFee;

    const payoutRecord: Payout = {
      id: `po_${++this.payoutIdCounter}`,
      publisherId,
      amount: payout,
      currency: paidInvoices[0]?.currency ?? 'USD',
      periodStart,
      periodEnd,
      invoiceCount: paidInvoices.length,
      status: 'pending',
    };

    this.payouts.set(payoutRecord.id, payoutRecord);
    return payoutRecord;
  }

  listPayouts(publisherId?: string): Payout[] {
    return Array.from(this.payouts.values()).filter((p) => {
      if (publisherId && p.publisherId !== publisherId) return false;
      return true;
    });
  }

  schedulePayout(payoutId: string, payDate?: number): Payout | null {
    const payout = this.payouts.get(payoutId);
    if (!payout) return null;
    payout.status = 'scheduled';
    payout.scheduledAt = payDate ?? Date.now() + 7 * 24 * 60 * 60 * 1000;
    return payout;
  }

  async processPayout(payoutId: string, paymentMethodId: string): Promise<Payout | null> {
    const payout = this.payouts.get(payoutId);
    if (!payout) return null;

    const result = await this.paymentProvider.processPayment(
      payout.id,
      payout.amount,
      payout.currency,
      paymentMethodId,
    );

    payout.status = result.success ? 'paid' : 'failed';
    payout.paidAt = result.success ? Date.now() : undefined;
    return payout;
  }

  markOverdue(): number {
    let count = 0;
    for (const inv of this.invoices.values()) {
      if (inv.status === 'sent' && Date.now() - inv.issuedAt > 30 * 24 * 60 * 60 * 1000) {
        inv.status = 'overdue';
        count++;
      }
    }
    return count;
  }
}
