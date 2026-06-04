# The Architecture of Intent, Part 8: Agentic Sandboxes (The A2U Protocol)

*Engineering the Post-GUI Era — Part 8 of 14*

---

The current state-of-the-art in autonomous AI is terrifying. 

If you use a coding agent today, the standard operating procedure is to hand a Large Language Model a root-level terminal, full read/write access to your filesystem, and an instruction like "Fix the billing bug." You then cross your fingers and hope it doesn't hallucinate a command that drops your production database or leaks your `.env` secrets into a public log.

This is the equivalent of handing a contractor the master keys to your house, your car, and your bank account just to fix a leaky sink. 

In [Part 7](./07-planners-not-operators.md), we established that USIR LLMs never execute code directly—they generate JSON DAGs for the `TopologicalExecutor`. But for long-running, asynchronous tasks (like "Migrate the database to DynamoDB"), the user isn't sitting there waiting to review every single DAG step. The runtime must spawn a "Worker Agent" to operate autonomously in the background.

To do this safely, USIR enforces a strict master-slave relationship between your sovereign runtime and the agent. The agent is treated as an untrusted contractor. It communicates with your runtime via the **A2U (Agent-to-USIR) Protocol**.

In this post, we will tear open the A2U architecture to see how USIR sandboxes AI through Trust Tiers, Sub-Graph Projections, and the `A2UDispatcher`.

### The Three-Tier Trust Gate

An agent in the USIR ecosystem does not have the ability to mutate state. It only has the ability to *propose* `IntentEnvelopes` back to the user's main runtime. 

Before any agent-proposed intent reaches the `TopologicalExecutor`, it must pass through the `TrustClassifier` (`packages/runtime/src/a2u/trust-classifier.ts`). The classifier evaluates the intent's `type` against the agent's reported `confidence` to assign a Trust Tier:

```typescript
export class TrustClassifier {
  classify(intent: BaseIntent, agentConfidence?: number): TrustTier {
    const conf = agentConfidence ?? 1.0;
    switch (intent.type) {
      // Tier 1 — read-only
      case 'intent.information.explain':
      case 'intent.navigation.locate':
        return { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };

      // Tier 2 — reversible mutations
      case 'intent.manipulation.edit':
      case 'intent.manipulation.create':
        return {
          tier: 2,
          // Requires approval if confidence drops below threshold (e.g., 0.85)
          requiresApproval: conf < CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE,
          logToProvenance: true,
          reversible: true,
        };

      // Tier 3 — irreversible or high-impact
      case 'intent.manipulation.delete':
      case 'intent.execution.run':
      case 'intent.collaboration.share':
        return { tier: 3, requiresApproval: true, logToProvenance: true, reversible: false };
    }
  }
}
```

This classification is the bedrock of A2U. 
*   **Tier 1 (Read):** The agent can traverse the graph and read files endlessly without bothering you.
*   **Tier 2 (Edit):** The agent can modify files autonomously *if* it is highly confident. If its confidence dips, the runtime intercepts the intent.
*   **Tier 3 (Destroy/Execute):** The agent is *never* allowed to delete a file, run an arbitrary shell script, or share data with an external peer without explicit human cryptographic consent.

### The A2U Dispatcher: Managing Urgency

When the agent packages its intent into an `A2UEnvelope`, it includes an `urgency` flag (`background`, `checkpoint`, or `blocker`). 

The `A2UDispatcher` (`packages/runtime/src/a2u/dispatcher.ts`) acts as the gatekeeper, routing these envelopes based on the Trust Classifier's verdict. 

```typescript
public async dispatch(envelope: A2UEnvelope): Promise<DispatchResult> {
  const trust = this.trustClassifier.classify(envelope.intent.intent, envelope.agentState.confidence);

  // 1. Unconditionally record the agent's proposal to the Provenance Ledger
  await this.provenanceStore.record({ /* ... */ });

  // 2. Route based on trust tier and urgency
  if (!trust.requiresApproval) {
    return this.executeImmediate(envelope);
  }

  if (envelope.urgency === 'background') {
    return this.queueForReview(envelope); // Silent queue
  }

  if (envelope.urgency === 'checkpoint') {
    return this.surfaceCheckpoint(envelope); // Timeout-able review
  }

  if (envelope.urgency === 'blocker') {
    return this.interruptUser(envelope); // Immediate interruption
  }

  return { status: 'queued' };
}
```

If the agent attempts a Tier 3 `intent.execution.run` (e.g., running `npm run build`), the `requiresApproval` flag forces the dispatcher into the bottom half of the logic. If the agent flagged it as a `checkpoint`, USIR surfaces an `InteractionWaypoint` to the user's active device (e.g., a quiet haptic double-tap on a smartwatch, showing the exact command the agent wants to run). 

The user can tap "Approve," "Reject," or "Discuss" (which opens a voice channel to the agent). 

### Sub-Graph Projections: Semantic Sandboxing

Trust Tiers prevent destructive actions, but how do you prevent an agent from reading your `.aws/credentials` file while it's fixing a CSS bug?

In legacy OS environments, you use Docker containers and file permissions. In USIR, you use **Sub-Graph Projections**.

When the user issues a `DelegateIntent` to spawn an agent, that intent includes a `sandboxEntityIds` array. The USIR runtime does not give the worker agent the full `SemanticSnapshot`. Instead, it runs a bounded Breadth-First Search starting from those allowed IDs, creating an ephemeral, isolated sub-graph. 

The agent is handed this restricted projection. To the agent, the rest of the workspace literally does not exist. It cannot query entities outside the sub-graph because the IDs are cryptographically omitted from its reality.

### The Critical Take: The Upfront Calculation Paradox

The A2U protocol’s use of Sub-Graph Projections is a spectacular security design, but it introduces a fatal UX paradox regarding `sandboxEntityIds`.

Imagine you tell your USIR agent: *"Refactor the database layer to use Prisma."* 

To spawn the agent securely, the USIR Intent Router must populate the `sandboxEntityIds` for the `DelegateIntent`. But how does the router know, upfront, exactly which files the database refactor will touch? It can guess the `/db` folder and maybe `models.ts`, but what about a random `/utils/metrics.ts` file that happens to import a legacy DB connection? 

Because the agent is trapped in the sub-graph, it will eventually realize it needs to modify `metrics.ts`. Because `metrics.ts` isn't in its sandbox, the agent is forced to halt and emit an `A2UEnvelope` with urgency `blocker`, asking the user to expand its permissions.

This turns "autonomous delegation" into a barrage of macOS-style permission popups. *"Agent wants access to metrics.ts", "Agent wants access to config.ts"*. 

If you make the sandbox too tight, the agent is paralyzed and constantly interrupts you. If you make the sandbox too loose (e.g., granting access to the root node of the workspace), the security model is compromised, bringing us right back to the AutoGPT danger zone. 

Until USIR develops a mechanism for agents to *negotiate* sub-graph expansions asynchronously—perhaps by leveraging a specialized L3 Information intent to "preview" graph edges without gaining edit access—the sandboxing model will remain too abrasive for frictionless mainstream adoption.

### What's Next

We've spent eight parts covering the theoretical, abstract, and highly complex inner workings of USIR: the ontology, the snapshots, the provenance DAG, the executor, and the trust models. 

It's time to bring it all down to earth. 

In **Part 9**, we are going to look at actual, deployable software. We will dissect the **VS Code Extension MVP**, acting as the Trojan Horse for USIR. We will look at `extension.ts`, see how these subsystems are wired together, and examine the painful reality of forcing Node.js to handle zero-latency Web Audio capture.

---
*Next:* **[Part 9: The Anatomy of an MVP (VS Code as a Trojan Horse)]**