# The Architecture of Intent, Part 12: The Capability Marketplace (Death of the App Store)

*Engineering the Post-GUI Era — Part 12 of 14*

---

The modern "App" is a 40-year-old architectural workaround. 

Historically, because operating systems lacked a universal semantic layer, software developers had to bundle three completely distinct things into a single deployable unit: 
1. **A data store** (to hold your state).
2. **A rendering engine** (to draw the UI).
3. **Behavioral logic** (the actual utility of the software).

Apple and Google built trillion-dollar empires by monopolizing the distribution of these bundles. But in the Universal Semantic Interaction Runtime (USIR), the bundle is destroyed. 

As we saw in [Part 10](./10-graph-meets-graph.md), the data store is replaced by your federated Semantic Graph. The rendering engine is replaced by your edge devices projecting Interaction Waypoints. 

All that remains of the "App" is the behavioral logic. In USIR, this is called a **Capability**—a stateless intent handler. 

If applications cease to exist, the App Store ceases to exist. How do developers distribute software? How do they get paid? To answer this, we look at `@usir/registry`: the USIR Capability Marketplace. 

### The Post-App Distribution Model

In USIR, you do not "download" or "install" a translation app. 

When your runtime's LLM generates an `intent.information.translate` step in an Execution Plan (see [Part 7](./07-planners-not-operators.md)), the `TopologicalExecutor` needs to know who can execute it. It queries the Capability Registry.

The Registry is a REST API that holds `CapabilityListings`. A listing is essentially a contract declaring: *"I am Provider X. I handle `intent.information.translate`. Here is my endpoint, my trust score, and my price."*

But if anyone can publish an intent handler, how do you prevent malware from registering as a handler for `intent.manipulation.delete` and wiping your graph? 

### The Mathematics of Reputation: The Trust Engine

App Stores solve security through centralized, human review. USIR solves it algorithmically using the `TrustEngine`.

Defined in `packages/registry/src/trust-engine.ts`, a capability's trust score is not a static 5-star rating. It is a weighted, composite algorithm consisting of Base identity verification, Uptime, Recency, and peer Attestations. 

Most importantly, trust in USIR is ephemeral. The engine implements **Exponential Half-Life Decay**:

```typescript
export class TrustEngine {
  // ...
  applyDecay(score: number, lastActivity: number): number {
    const elapsed = Date.now() - lastActivity;
    if (elapsed <= 0) return score;
    
    // DEFAULT_DECAY_CONFIG.halfLifeMs is usually 30 days
    const halfLives = elapsed / this.config.decayConfig.halfLifeMs;
    return Math.round(score * Math.pow(0.5, halfLives));
  }
}
```

This is a profound philosophical statement encoded in math. A capability that was highly rated two years ago but hasn't been attested or updated recently is mathematically downgraded. Trust decays unless it is continuously proven.

When the `ReputationOracle` receives an attestation from a peer on the federated network, it weighs that attestation based on the *attestor's* own trust score—mimicking the PageRank algorithm or academic citation networks. The `TopologicalExecutor` on your local machine will automatically filter out any capability whose decayed trust score falls below your locally defined safety threshold.

### Micro-transactions for Intent: The Pricing Engine

If developers aren't charging $9.99/month for an iOS App subscription, how does the economy function? 

The `@usir/registry` package includes a `PricingEngine` and an `Invoicing` module that turns intent execution into programmatic micro-transactions. Capabilities can declare `RateCards` supporting four models: `free`, `per-call`, `metered`, or `subscription`.

Because USIR's executor tracks exactly what happens at every step of a DAG, the `UsageTracker` effortlessly records capability invocations. At the end of a billing period, the `PricingEngine` processes the usage:

```typescript
// From packages/registry/src/pricing-engine.ts
export class PricingEngine {
  computeInvoiceLines(capability: Capability, usage: UsageAggregate): InvoiceLine[] {
    const card = this.rateCards.get(capability.capabilityId) ?? this.defaultRateCard(capability);
    const lines: InvoiceLine[] = [];

    // ... handles 'free' and 'per-call' logic ...

    if (card.model === 'metered') {
      const tiers = card.tiers ?? [];
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
    // ...
  }
}
```

The user receives a single unified invoice from the USIR registry, aggregating the micro-fractions of a cent spent invoking the "Translation" capability alongside the "PDF Generation" capability. The registry then utilizes the `PaymentProvider` interface to process payouts to the independent developers.

### The Critical Take: The Platform Fee Delusion

The `@usir/registry` package is beautifully architected, but it contains one line of code that betrays the entire ethos of the project. 

In `packages/registry/src/invoicing.ts`, inside the `computePayout` function, we find this:

```typescript
const platformFee = Math.round(totalEarnings * 0.1);
const payout = totalEarnings - platformFee;
```

A hardcoded 10% platform fee. 

USIR goes to extraordinary lengths in the `@usir/federation` package to ensure that runtimes are sovereign, decentralized, and P2P. It completely dismantles the SaaS monolith so that users own their own data and logic execution. 

To turn around and implement a centralized Registry that extracts a 10% rent on every micro-transaction is to fundamentally misunderstand the economics of open protocols. It assumes the creators of USIR can establish the same monopoly choke-point as Apple or Google. They cannot.

If USIR is truly the "TCP/IP of Interaction," its capability discovery mechanism must look like DNS or NPM—a distributed, open-source directory, not a centralized tollbooth. 

In a mature USIR ecosystem, payments shouldn't flow through a central USIR-owned invoicing server. They should flow directly P2P from the consumer's runtime to the provider's endpoint using cryptocurrency micro-transactions or direct Stripe Connect webhooks embedded in the capability metadata. The 10% `platformFee` is a startup's hallucination inside an otherwise robust, open architecture.

### What's Next

The theoretical architecture of USIR is now complete. We have the Intent Ontology, the Semantic Graph, the Runtime Executor, the Federation layer, and the Capability Marketplace.

But there is a massive elephant in the room. This entire ecosystem relies on software actually exposing semantic endpoints. What about the 10 million legacy Windows applications, janky internal web tools, and physical IoT devices that have no idea what a `SemanticEntity` is?

In **Part 13**, we will venture into the "Semantic Horizon." We will examine the most dangerous and exciting parts of the codebase: the OS, IoT, and XR adapters, and the theoretical **Zero-Shot VLM Compiler** designed to permanently conquer the long tail of legacy software.

---
*Next:* **[Part 13: Bridging the Legacy World (Zero-Shot & Ambient Sensors)]**