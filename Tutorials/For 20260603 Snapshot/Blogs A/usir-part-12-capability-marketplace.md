# Part 12: The Capability Marketplace — An App Store Built on Intents

*Part 12 of 14 in the USIR Deep-Dive Blog Series — "Decoding the Post-GUI Runtime"*

← [Part 11: Federation — P2P Semantic Graphs Over WebRTC](#) | [Part 13: The Semantic Horizon — IoT, XR, OS, and the Zero-Shot Adapter](#) →

---

Every great protocol eventually faces the same question: once you've defined how things talk to each other, how do you make a market out of it? HTTP had REST APIs and then AWS. npm made Node.js an ecosystem. The App Store turned iOS from a phone OS into an economy.

USIR's answer is `@usir/registry`: a full capability marketplace where intent handlers are published, discovered, priced, and paid for as if they were API services. This is Year 3+ USIR — not a developer tool, but an ecosystem primitive. The question worth asking seriously is whether this model represents the future of software distribution, or whether it's a chicken-and-egg trap that no amount of clever engineering can escape.

Let's go deep on the implementation before we answer that.

---

## What is a "Capability" in Marketplace Terms?

Before getting into the machinery, it's worth being precise about the unit of exchange. In the USIR model, a **capability** is not an app, not a plugin, and not a microservice. It's an intent handler: a component that declares which intent types from the universal ontology it can fulfill, what permissions it needs to do so, and how it exposes its execution endpoint.

The core data type from `@usir/protocol/capability`:

```typescript
interface Capability {
  capabilityId: string;       // URI: "cap://vendor/product/v1"
  displayName: string;
  handlesIntents: Array<BaseIntent['type']>;   // e.g. ['intent.navigate.open', 'intent.edit.transform']
  intentLayers: IntentLayer[];                 // e.g. ['L2', 'L3']
  provider: {
    id: string;
    name: string;
    trustScore: number;       // 0–1 base trust from the provider record
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
```

The `handlesIntents` field is what makes this different from every other marketplace. You're not browsing "a code formatter" or "a translation service" — you're browsing handlers for `intent.edit.transform` and `intent.translate.localize`. The runtime already knows what it needs; the marketplace is how it finds who can provide it.

A `CapabilityListing` wraps a `Capability` with registry-level metadata:

```typescript
interface CapabilityListing {
  capability: Capability;
  registryMetadata: RegistryMetadata;   // category, tags, verification status, timestamps
  status: 'active' | 'deprecated' | 'removed';
}
```

And `CapabilityCategory` covers the intended domains: `translation`, `productivity`, `communication`, `development`, `data`, `media`, `automation`, `iot`, `xr`, `system`, `other`. Notably, `iot` and `xr` are first-class categories — this marketplace is scoped from day one to include physical-world adapters, not just software tooling.

---

## The Trust Engine: Five-Factor Scoring with Exponential Decay

Trust in a marketplace is not a boolean. "Verified" vs "unverified" is a useful shortcut but it collapses the real signal: some capabilities are new but well-built; some are old and battle-proven; some have third-party attestations; some have high uptime records. The USIR `TrustEngine` scores all five of these dimensions and combines them via a weighted sum.

```
Architecture: Trust Scoring Pipeline

  CapabilityListing
        │
        ▼
┌─────────────────────────────────────────────────────┐
│                    TrustEngine                      │
│                                                     │
│  Factor          Weight  Score Source               │
│  ─────────────── ──────  ─────────────────────────  │
│  base            0.30    provider.trustScore × 100  │
│  verification    0.20    0 / 30 / 60 / 100          │
│  attestation     0.25    ReputationOracle aggregate  │
│  uptime          0.15    uptime step function        │
│  recency         0.10    last-updated step function  │
│                                                     │
│  overall = Σ(score × weight)  ∈ [0, 100]           │
└─────────────────────────────────────────────────────┘
        │
        ▼
    TrustScore { overall, factors[], lastUpdated }
```

The implementation in `trust-engine.ts`:

```typescript
computeScore(
  listing: CapabilityListing,
  attestations: AttestationAggregate | null,
  uptimeMs: number,
): TrustScore {
  const baseScore        = listing.capability.provider.trustScore * 100;
  const verificationScore = this.verificationBonus(listing);
  const attestationScore  = attestations?.averageScore ?? 50;
  const uptimeScore       = this.uptimeScore(uptimeMs);
  const recencyScore      = this.recencyScore(listing.registryMetadata.updatedAt);

  const factors: TrustFactor[] = [
    { name: 'base',         weight: TRUST_WEIGHTS.base,         score: baseScore,         source: 'provider' },
    { name: 'verification', weight: TRUST_WEIGHTS.verification, score: verificationScore, source: 'registry' },
    { name: 'attestation',  weight: TRUST_WEIGHTS.attestation,  score: attestationScore,  source: attestations ? `peers (${attestations.count})` : 'default' },
    { name: 'uptime',       weight: TRUST_WEIGHTS.uptime,       score: uptimeScore,       source: 'registry' },
    { name: 'recency',      weight: TRUST_WEIGHTS.recency,      score: recencyScore,      source: 'registry' },
  ];

  const overall = Math.round(
    factors.reduce((sum, f) => sum + f.score * f.weight, 0),
  );

  return {
    overall: Math.min(100, Math.max(0, overall)),
    factors,
    lastUpdated: Date.now(),
  };
}
```

The weights are defined as named constants in `@usir/protocol`:

```typescript
export const TRUST_WEIGHTS = {
  base:         0.30,
  verification: 0.20,
  attestation:  0.25,
  uptime:       0.15,
  recency:      0.10,
};
```

These deserve examination. The `base` weight (30%) encodes how much you trust the publisher's self-declared trustScore. This is circular unless publishers' base scores are themselves governed by some external process — and the protocol defines `PublisherIdentity` with a `publicKey` field, suggesting PKI-based identity, but the validation chain that maps key → trustScore is not yet specified. The `attestation` weight (25%) is the most interesting: peer attestations carry more weight than registry verification (20%), which is an explicit bet that community signal is more reliable than centralized review.

The `uptime` and `recency` step functions are deliberately coarse:

```typescript
private uptimeScore(uptimeMs: number): number {
  const days = uptimeMs / (24 * 60 * 60 * 1000);
  if (days >= 90) return 100;
  if (days >= 30) return 80;
  if (days >= 7)  return 60;
  if (days >= 1)  return 40;
  return 20;
}

private recencyScore(lastUpdated: number): number {
  const elapsed = Date.now() - lastUpdated;
  const days = elapsed / (24 * 60 * 60 * 1000);
  if (days <= 1)  return 100;
  if (days <= 7)  return 80;
  if (days <= 30) return 60;
  if (days <= 90) return 40;
  return 20;
}
```

These are not precision metrics — they're editorial judgments baked in as code. A capability last updated 31 days ago scores 40 on recency; 29 days ago scores 60. The 30-day cliff is a design decision, not a measurement. That's fine — the point is signal direction, not mathematical precision.

### Exponential Decay: Trust That Forgets

The most distinctive part of the trust model is what happens when a capability goes quiet:

```typescript
applyDecay(score: number, lastActivity: number): number {
  const elapsed = Date.now() - lastActivity;
  if (elapsed <= 0) return score;
  const halfLives = elapsed / this.config.decayConfig.halfLifeMs;
  return Math.round(score * Math.pow(0.5, halfLives));
}
```

With the default 30-day half-life (`DEFAULT_DECAY_CONFIG.halfLifeMs = 30 * 24 * 60 * 60 * 1000`):

- At 0 days: score × 1.0 (full)
- At 30 days: score × 0.5
- At 60 days: score × 0.25
- At 90 days: score × 0.125

The test verifies this explicitly: `engine.applyDecay(100, Date.now() - 60 * 24 * 60 * 60 * 1000)` returns exactly 25. A capability not called for 90 days has its trust quartered, regardless of its historical quality. The rationale is sound: a capability you can't see being actively maintained and used is a capability you shouldn't fully trust, because the author may have moved on, the endpoint may be degrading, or the intent schema may have drifted.

This is the right policy for a live marketplace. It's a serious UX problem for a pre-alpha project that has no real traffic yet — every capability will rapidly decay to zero in the absence of synthetic usage data.

---

## The Reputation Oracle: Attestations with Expiry

The `ReputationOracle` manages third-party attestations — think peer reviews with structured scores and expiry timestamps:

```typescript
export class ReputationOracle {
  private attestations = new Map<string, Attestation[]>();
  private aggregates   = new Map<string, AttestationAggregate>();
  private config: OracleConfig;    // { attestationExpiryMs: 90 days, minAttestations: 1 }

  submitAttestation(attestation: Attestation): void {
    if (Date.now() > attestation.expiresAt) return;  // reject expired on arrival

    const list = this.attestations.get(attestation.capabilityId)!;
    const existing = list.findIndex((a) => a.attestorId === attestation.attestorId);
    if (existing >= 0) {
      list[existing] = attestation;   // one attestation per attestor, updatable
    } else {
      list.push(attestation);
    }
    this.recomputeAggregate(attestation.capabilityId);
  }
```

The `Attestation` type carries `attestorId`, `score` (0–100), an optional `comment`, and critically both `attestedAt` and `expiresAt`. Attestations are not permanent — they expire. The default expiry window is 90 days, matching the decay half-life intuition: old attestations should not cast an indefinitely long shadow on a capability's reputation.

The aggregate computation is a simple average, but the trust score's weighting (25% of overall) means a well-attested capability can materially outrank an unattested one. The `source` field on the attestation factor is rendered as `peers (N)` where N is the attestation count — a capability with 50 peer attestations doesn't just have a higher score, it carries visible credibility signals in the UI.

The design borrows from academic citation networks: "third-party attestations carry weight proportional to the attester's own trust score." That last part — weighting by attester trustScore — is *mentioned in the architecture notes but is not in the current implementation*. The `recomputeAggregate` method is a plain average of `a.score` values with no attester weighting:

```typescript
private recomputeAggregate(capabilityId: string): void {
  const valid = this.getAttestations(capabilityId);
  const sum   = valid.reduce((s, a) => s + a.score, 0);
  this.aggregates.set(capabilityId, {
    capabilityId,
    averageScore:   Math.round(sum / valid.length),
    count:          valid.length,
    lastAttestedAt: Math.max(...valid.map((a) => a.attestedAt)),
  });
}
```

The attester-weighted PageRank model is left as future work. This matters: without attester weighting, Sybil attacks on the attestation system are cheap — a single publisher could create many low-reputation accounts to cross-attest each other.

---

## Four Pricing Models, One Engine

The `PricingEngine` handles rate card management and invoice line computation for all four pricing models. It's cleanly separated from the trust layer — a free capability can have a perfect trust score; a subscription capability can have a terrible one.

```typescript
export class PricingEngine {
  private rateCards = new Map<string, RateCard>();

  computeInvoiceLines(capability: Capability, usage: UsageAggregate): InvoiceLine[] {
    const card = this.rateCards.get(capability.capabilityId)
                 ?? this.defaultRateCard(capability);
    // ...
  }
}
```

The four models, illustrated with their test cases:

**Free:** Zero-cost line item, always. Simple to handle, surprisingly useful — many capabilities in the early ecosystem will be free to bootstrap adoption.

**Per-call:** `quantity × perCallCost`. A capability priced at `$0.05/call` with 100 calls in the billing period generates a single `InvoiceLine` with `total: 5.00`.

**Metered with tiers:** This is the most powerful pricing model, and the implementation is correct. For a rate card with tiers `[0–1000 @ $0.01, 1001–∞ @ $0.005]`, consuming 3000 units generates two lines: one for the first 1000 units (Tier 0–1000, $10.00) and one for the remaining 2000 units (Tier 1001–∞, $10.00) — a total of $20.00. The test verifies `toBeCloseTo(20.01, 2)` (the extra cent is a rounding artifact from the tier boundary inclusive/exclusive handling).

**Subscription:** Flat periodic fee, `$9.99/month`. Usage quantity is ignored — the billing period triggers one line item regardless of how many times the capability was invoked.

```typescript
if (card.model === 'metered') {
  let remaining = usage.totalQuantity;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const tierUnits = tier.toUnits === null
      ? remaining
      : Math.min(remaining, tier.toUnits - tier.fromUnits + 1);
    const tierTotal = Math.round(tierUnits * tier.costPerUnit * 100) / 100;
    lines.push({
      description: `Tier ${tier.fromUnits}–${tier.toUnits ?? '∞'} (${tier.costPerUnit}/${card.meteredUnit ?? 'unit'})`,
      quantity:    tierUnits,
      unitCost:    tier.costPerUnit,
      total:       tierTotal,
    });
    remaining -= tierUnits;
  }
}
```

The `InvoiceLine` structure — `description`, `quantity`, `unitCost`, `total` — maps directly to what a standard billing UI would render. This is not an accident; the design is clearly influenced by Stripe's invoice line item model.

---

## The Invoicing and Payout Pipeline

`Invoicing` is the orchestrating class that ties together the `PricingEngine`, `UsageTracker`, and `PaymentProvider` into a complete billing lifecycle:

```
Invoice Lifecycle

  generateInvoice()  →  [draft]
       │
  sendInvoice()      →  [sent]
       │
  processPayment()   →  [paid]  ──→  computePayout()  →  [Payout: pending]
       │                                                        │
  markOverdue()      →  [overdue]                      schedulePayout()  →  [scheduled]
                                                               │
                                                        processPayout()  →  [paid / failed]
```

The `computePayout()` method applies the 10% platform fee and produces a `Payout` record:

```typescript
computePayout(publisherId: string, periodStart: number, periodEnd: number): Payout {
  const paidInvoices = this.listInvoices(publisherId).filter(
    (inv) => inv.status === 'paid' && inv.paidAt && inv.paidAt >= periodStart && inv.paidAt <= periodEnd,
  );

  const totalEarnings = paidInvoices.reduce((s, inv) => s + inv.total, 0);
  const platformFee   = Math.round(totalEarnings * 0.1);      // 10%
  const payout        = totalEarnings - platformFee;

  return {
    id:           `po_${++this.payoutIdCounter}`,
    publisherId,
    amount:       payout,
    currency:     paidInvoices[0]?.currency ?? 'USD',
    periodStart,
    periodEnd,
    invoiceCount: paidInvoices.length,
    status:       'pending',
  };
}
```

Tax is computed at invoice generation time as a flat 8%: `tax = Math.round(subtotal * 0.08)`. The 8% is a hardcoded constant — not configurable by region, not VAT-aware, not jurisdiction-specific. This is a placeholder that works for testing but would need a real tax calculation library (TaxJar, Avalara, or equivalent) before production deployment.

The payment abstraction is clean. `PaymentProvider` is a four-method interface:

```typescript
interface PaymentProvider {
  createCheckout(session): Promise<CheckoutSession>;
  processPayment(invoiceId, amount, currency, paymentMethodId): Promise<PaymentResult>;
  refundPayment(transactionId, amount?): Promise<PaymentResult>;
  getPaymentMethods(consumerId): Promise<PaymentMethod[]>;
}
```

`MockPaymentProvider` implements this with always-successful in-memory responses, using `txn_${Date.now()}_${randomString}` as transaction IDs. The interface is correctly designed for Stripe or PayPal adapters — the `createCheckout` signature maps directly to Stripe's `PaymentIntent` creation pattern.

---

## The Registry Server: 20+ Endpoints, One HTTP Module

`RegistryServer` is built on raw Node.js `http` — no Express, no Fastify, no external HTTP framework. This is a deliberate choice to minimize dependencies; the server is meant to be a lightweight registry host that larger infrastructure wraps, not a standalone web application.

The REST API surface groups into seven functional areas:

```
Capability CRUD
  POST   /capabilities            publish a new capability
  GET    /capabilities/:id        get a specific listing
  DELETE /capabilities/:id        unpublish
  GET    /capabilities            search with query params

Trust & Attestation
  GET    /capabilities/:id/trust  get trust score breakdown
  POST   /attestations            submit an attestation
  GET    /attestations/:capId     get attestations for a capability

Usage Tracking
  POST   /usage                   record a usage event
  GET    /usage/:capId            get usage aggregate

Invoicing & Payments
  POST   /invoices                generate an invoice
  GET    /invoices/:id            get invoice
  POST   /invoices/:id/send       mark as sent
  POST   /invoices/:id/pay        process payment
  POST   /invoices/:id/checkout   create checkout session

Payouts
  POST   /payouts                 compute a payout
  POST   /payouts/:id/schedule    schedule payout
  POST   /payouts/:id/process     process payout

Publisher & Discovery
  GET    /publishers              list publisher identities
  GET    /stats                   registry statistics
  GET    /health                  health check
```

The `RegistryServer` holds direct references to the subsystems it coordinates: `public readonly store = new RegistryStore()`, `public readonly trustEngine = new TrustEngine()`, `public readonly oracle = new ReputationOracle()`. This is deliberately flat — no service layer, no dependency injection container. It's a single cohesive unit, which makes it easy to test but harder to extend without touching the server class itself.

---

## The Registry Client: Sync, Cache, and Discovery

`@usir/registry-client` is the runtime-side SDK that adapters use to register capabilities and consumers use to discover them:

```typescript
// From registry-client.ts
async publish(
  capability: Capability,
  category: CapabilityCategory,
  tags?: string[],
): Promise<CapabilityListing> {
  return this.request<CapabilityListing>('POST', '/capabilities', { capability, category, tags });
}

async search(query: RegistrySearchQuery): Promise<RegistrySearchResult> {
  const params = new URLSearchParams();
  if (query.query)        params.append('q', query.query);
  if (query.intentType)   params.append('intentType', query.intentType);
  if (query.minTrustScore !== undefined) params.append('minTrustScore', String(query.minTrustScore));
  // ...
  return this.request<RegistrySearchResult>('GET', `/capabilities?${params}`);
}
```

The `LocalCache` in the client maintains an in-memory copy of capability listings that can be queried without network round-trips. This is important for the runtime's hot path — when the `LLMRouter` needs to find handlers for an intent, it should not be making HTTP calls inline. The sync protocol handles periodic refresh and delta updates.

The search interface is exactly what a capability-aware router needs: filter by `intentType`, floor by `minTrustScore`, paginate with `offset`/`limit`. The `RegistryStore.search()` on the server side applies these filters in-memory with a sort on `trustScore` descending — simple but effective for thousands of capabilities, where a real deployment would replace this with a proper search index.

---

## The Full Picture

Putting the subsystems together, the marketplace flow from publish to payout looks like this:

```
Publisher                Registry Server               Consumer / Runtime
────────                 ───────────────               ──────────────────
publish(capability) ──→  RegistryStore.add()
                         TrustEngine.computeScore()
                         ← CapabilityListing (with initial trust score)

                    ←──  search(intentType: 'intent.edit.transform',
                               minTrustScore: 60)
                         ← [sorted CapabilityListing[]]

runtime selects
best match,
invokes capability
endpoint directly ─────────────────────────────────→ (capability executes)

                         POST /usage  ←─────────────── UsageTracker.recordUsage()

billing period ends:
                         POST /invoices   (generateInvoice)
                         POST /invoices/:id/pay (processPayment)

publisher period closes:
                         POST /payouts    (computePayout: gross - 10%)
                         POST /payouts/:id/process
```

One critical observation: capability *invocation* does not route through the registry server. The registry handles discovery and billing; execution is peer-to-peer between the runtime and the capability endpoint. This is the right architecture — the registry is not in the hot path. But it means usage tracking depends on the consuming runtime honestly calling `POST /usage` after each invocation. There's no server-side enforcement. In a trustless environment, this is a significant gap.

---

## What the Registry Does Not Yet Solve

The marketplace design is architecturally complete and impressively specified. But several problems need honest naming.

**The cold-start ecosystem problem.** The trust decay system, the attestation network, the usage-based reputation — all of these are calibrated for a live marketplace with meaningful traffic. At zero capabilities and zero consumers, every trust score is the same (the default provider score), every attestation table is empty, and every payout is zero. The system's value proposition doesn't exist until the ecosystem does.

**The chicken-and-egg dynamic.** Consumers will only adopt USIR if there are high-quality capabilities in the registry. Publishers will only invest in USIR capabilities if there are consumers to pay for them. This is the standard two-sided marketplace cold-start problem, and no amount of engineering solves it — it requires a go-to-market strategy. Anthropic is one plausible anchor publisher. A few well-known open-source projects integrating with USIR could be another. But the plan is not articulated in the repo.

**The 10% platform fee and centralization.** The fee implies a central operator (Anthropic? A USIR Foundation?) who collects the spread. This is fine as a business model, but it creates a single point of control over the entire capability economy. The smarter architectural play — and one worth considering seriously — is to open-source the registry server and allow community-run registries, the way npm, crates.io, and PyPI operate. Federated registries with cross-registry capability discovery would be far more resilient. The current architecture doesn't preclude this, but it doesn't enable it either: there's no inter-registry protocol, no capability namespace ownership system, no mechanism for a runtime to search across multiple registries.

**The tax placeholder.** Eight percent flat. No jurisdiction support. No VAT. This works for testing; it doesn't work for Europe, India, Australia, or any jurisdiction with real digital services tax requirements.

**The billing trust gap.** Usage reporting is honor-system. The consuming runtime self-reports calls. Publishers cannot independently verify consumption counts. In a system where both parties have financial incentives to misreport (consumers to under-report, publishers to over-report), the absence of a verifiable metering layer is a real vulnerability.

**Zero end-to-end billing tests.** The 72 registry tests cover unit behavior of each subsystem. None of them test a full publish → discover → invoke → track-usage → invoice → pay → payout cycle against a running server. The integration test coverage cliff is the most practically dangerous gap.

---

## Is This the Future of Software Distribution?

The thesis deserves a direct answer.

The USIR Capability Marketplace represents a genuine architectural bet: that the right primitive for software distribution in an AI-native world is not the *app* (a bundle of UI + logic) but the *intent handler* (a typed, priced, discoverable semantic service). This bet is interesting for several reasons.

It aligns with how LLM-integrated systems actually work. When an LLM is routing a user's natural language command to an action, it doesn't care about the app's chrome — it cares about what the action does and whether it can trust the handler. A capability marketplace where handlers declare their intent types and trust scores is a much better match for LLM-native workflows than an app store where distribution is organized around icons and screenshots.

It has a cleaner composability story than any current app store. Because capabilities are typed by intent, the runtime can automatically compose them: "summarize, then translate, then email" is three capability calls that the router can discover, sequence, and execute — without any of the three publishers knowing about each other.

But the model faces a distribution problem that intent-typing doesn't solve. Developers don't abandon app stores — they build on top of them. The App Store's success isn't about its API design; it's about distribution reach, payment rails, and user trust. USIR's marketplace needs all three, and currently has none of them outside of the registry API itself.

The most likely successful path is probably not a centralized USIR marketplace at all. It's the same path npm took: an open-source registry server, a CLI to publish and install, a community of package maintainers, and eventually a commercial layer that adds private registries and enterprise features. The `@usir/registry` package is already good enough to be that foundation. What's missing is the community play: publishing the registry as a hosted service, open-sourcing the client tooling, and making capability publication a five-minute exercise.

Whether that happens depends on factors that no amount of architectural elegance can guarantee — but the architecture, at least, is ready for it.

---

## Code Touchpoints

The marketplace implementation lives across three packages:

- `packages/registry/` — the server: `RegistryStore`, `RegistryServer`, `TrustEngine`, `ReputationOracle`, `UsageTracker`, `PricingEngine`, `Invoicing`, `MockPaymentProvider`
- `packages/registry-client/` — the client SDK: `RegistryClient`, `LocalCache`, `SyncProtocol`
- `packages/protocol/src/capability/` — shared types: `Capability`, `CapabilityListing`, `RateCard`, `Invoice`, `Payout`, `TRUST_WEIGHTS`, `DEFAULT_DECAY_CONFIG`

72 registry tests + 8 registry-client tests. No end-to-end billing tests.

---

*Next: [Part 13: The Semantic Horizon — IoT, XR, OS, and the Zero-Shot Adapter](#)*

*The most ambitious adapters in the repo. We separate working code from spec fiction.*
