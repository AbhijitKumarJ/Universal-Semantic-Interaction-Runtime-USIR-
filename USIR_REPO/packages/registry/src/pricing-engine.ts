import type { RateCard, UsageAggregate, InvoiceLine, Capability } from '@usir/protocol/capability';

export class PricingEngine {
  private rateCards = new Map<string, RateCard>();

  setRateCard(card: RateCard): void {
    this.rateCards.set(card.capabilityId, card);
  }

  getRateCard(capabilityId: string): RateCard | null {
    return this.rateCards.get(capabilityId) ?? null;
  }

  removeRateCard(capabilityId: string): void {
    this.rateCards.delete(capabilityId);
  }

  computeInvoiceLines(
    capability: Capability,
    usage: UsageAggregate,
  ): InvoiceLine[] {
    const card = this.rateCards.get(capability.capabilityId) ?? this.defaultRateCard(capability);
    const lines: InvoiceLine[] = [];

    if (card.model === 'free') {
      lines.push({
        description: `${capability.displayName} (free)`,
        quantity: 0,
        unitCost: 0,
        total: 0,
      });
      return lines;
    }

    if (card.model === 'per-call') {
      const cost = card.perCallCost ?? capability.pricing.costPerCall ?? 0;
      lines.push({
        description: `${capability.displayName} — ${usage.totalQuantity} calls × ${cost} ${card.currency}`,
        quantity: usage.totalQuantity,
        unitCost: cost,
        total: usage.totalQuantity * cost,
      });
      return lines;
    }

    if (card.model === 'metered') {
      const tiers = card.tiers ?? [];
      if (tiers.length === 0) {
        const cost = card.perCallCost ?? 0;
        lines.push({
          description: `${capability.displayName} — ${usage.totalQuantity} ${card.meteredUnit ?? 'units'} × ${cost}`,
          quantity: usage.totalQuantity,
          unitCost: cost,
          total: usage.totalQuantity * cost,
        });
        return lines;
      }

      let remaining = usage.totalQuantity;
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const tierUnits = tier.toUnits === null
          ? remaining
          : Math.min(remaining, tier.toUnits - tier.fromUnits + 1);
        const tierTotal = Math.round(tierUnits * tier.costPerUnit * 100) / 100;
        lines.push({
          description: `Tier ${tier.fromUnits}–${tier.toUnits ?? '∞'} (${tier.costPerUnit}/${card.meteredUnit ?? 'unit'})`,
          quantity: tierUnits,
          unitCost: tier.costPerUnit,
          total: tierTotal,
        });
        remaining -= tierUnits;
      }
      return lines;
    }

    if (card.model === 'subscription') {
      const cost = card.subscriptionCost ?? 0;
      lines.push({
        description: `${capability.displayName} — ${card.subscriptionInterval ?? 'monthly'} subscription`,
        quantity: 1,
        unitCost: cost,
        total: cost,
      });
      return lines;
    }

    return lines;
  }

  private defaultRateCard(capability: Capability): RateCard {
    return {
      capabilityId: capability.capabilityId,
      model: capability.pricing.model,
      currency: capability.pricing.currency ?? 'USD',
      perCallCost: capability.pricing.costPerCall,
    };
  }
}
