# The Semantic Horizon, Part 4: Agentic Delegation — The L7 Intents and Asynchronous Graphs

Over the course of building the Universal Semantic Interaction Runtime (USIR), we have optimized fiercely for speed. From the 16ms Hot Tier to the instantaneous Visual Handshake, every architectural decision was designed to keep the user in a frictionless, synchronous flow state.

But what happens when a task shouldn't be fast?

Imagine a developer says, *"Migrate the authentication database from PostgreSQL to DynamoDB."*

This is not a task you want the Intent Router to handle in a single sub-second execution loop. It requires reading hundreds of files, generating schemas, writing migration scripts, and running tests. It could take an hour.

If USIR only supports synchronous, interactive execution, it is just a fast pair-programmer. To become a true operating system for the AI era, USIR must support **Autonomous Delegation**. It must be able to spawn independent "Worker Agents," hand them a massive task, and let them operate in the background.

In this post, we will expand USIR to support asynchronous operations using the **L7 Delegation Intents**, explore how to securely sandbox an agent's view of your Semantic Graph, and design the protocol for agents to report back for human approval.

## 1. The L7 Delegation Intents

In our Universal Intent Ontology (`packages/protocol/src/intents/index.ts`), we defined L1 through L6 to cover navigation, information, and immediate execution. Now, we introduce the **L7 Delegation Intents**.

```typescript
// --- L7: Delegation Intents ---

export interface PlanIntent extends BaseIntent {
  type: 'intent.delegation.plan';
  target: SemanticEntity | CognitiveReference; // The goal, e.g., "auth_database"
  objective: string; // e.g., "Migrate to DynamoDB"
}

export interface DelegateIntent extends BaseIntent {
  type: 'intent.delegation.delegate';
  target: SemanticEntity | CognitiveReference;
  objective: string;
  /** User-defined constraints the agent must respect */
  constraints?: string[];
  /** Confidence threshold below which the agent must checkpoint */
  confidenceThreshold?: number;
  /** Sandbox: which entities the agent may touch */
  sandboxEntityIds?: string[];
  /** Max execution time before forced checkpoint (ms) */
  maxExecutionMs?: number;
}
```

When the Intent Router detects a request of this magnitude, it does not generate an `ExecutionPlan` directly. Instead, it generates a `PlanIntent` to outline the strategy, and a `DelegateIntent` to spawn the execution environment.

## 2. The Worker Agent Sandbox

A Worker Agent needs access to the semantic graph to do its job, but you absolutely do not want it to be able to delete your production database or modify your personal photos. We solve this using a **Projected Sandbox**.

When the user approves the `DelegateIntent`, the runtime extracts the `sandboxEntityIds` and creates a sub-graph projection. The Worker Agent runs in an isolated process (or container) and is only given read/write access to the entities within that sub-graph.

```typescript
// In packages/runtime/src/a2u/sandbox.ts
export class AgentSandbox {
  constructor(
    private fullGraph: SemanticGraph,
    private allowedEntityIds: string[]
  ) {}

  public project(): SemanticGraph {
    const subGraph = createSemanticGraph();
    // BFS starting from the allowed roots, projecting only allowed nodes
    for (const rootId of this.allowedEntityIds) {
      bfs(this.fullGraph, rootId, 5, (id) => {
        if (this.allowedEntityIds.includes(id)) {
          const node = this.fullGraph.nodes.get(id);
          if (node) addEntity(subGraph, node.entity);
        }
      });
    }
    return subGraph;
  }
}
```

The agent is given a token (a UCAN-style capability, as noted in the first review) that cryptographically limits its access. The Topological Executor in the agent's runtime validates every tool call against this token before executing it.

## 3. The A2U Envelope: Agent-to-USIR Communication

A Worker Agent doesn't speak "voice." It speaks the A2U (Agent-to-USIR) protocol. The protocol consists of envelopes that the agent sends back to the main runtime to request permissions, report progress, or signal completion.

```typescript
// In packages/runtime/src/a2u/dispatcher.ts
export interface A2UEnvelope {
  intent: IntentEnvelope;
  agentState: {
    workerId: string;
    parentDelegateIntentId: string;
    planProgress: { totalSteps: number; completedSteps: number; currentPhase: string; estimatedRemaining: number };
    sandboxEntityIds: string[];
    confidence: number;
  };
  surfacingReason:
    | { type: 'checkpoint'; description: string }
    | { type: 'uncertainty'; question: string; options?: string[] }
    | { type: 'constraint-violation'; constraint: string; proposed: string }
    | { type: 'completion'; summary: string }
    | { type: 'failure'; reason: string; recoverable: boolean };
  urgency: 'background' | 'checkpoint' | 'blocker';
  defaultBehaviour: { action: 'proceed' | 'pause' | 'abort'; timeoutMs: number; proceedCondition?: string };
}
```

The main runtime has an `A2UDispatcher` that listens for these envelopes.

## 4. The A2UDispatcher: The Gatekeeper

When an envelope arrives, the dispatcher applies the 3-Tier Trust Classifier.

1. **Tier 1 (Information):** The agent wants to read a file. The dispatcher executes the intent immediately, sends the result back to the agent.
2. **Tier 2 (Reversible Edit):** The agent wants to modify a file. If `agentState.confidence > 0.85`, it executes. If not, it builds a `checkpoint` Waypoint and pushes it to the user's watch/XR overlay.
3. **Tier 3 (Irreversible):** The agent wants to drop a database table. The dispatcher builds a `blocker` Waypoint, interrupting the user with an urgent request for approval.

For Tier 2 and 3, the generated Waypoint is an L7 `CheckpointIntent`. The user reviews the proposed change (often a semantic diff) and replies with `approve`, `reject`, or `discuss`. The response is routed back to the agent.

## 5. The Lifecycle of a Multi-Hour Task

Let's trace the lifecycle of the database migration:

1. **T=0:** User issues `DelegateIntent`. Runtime creates sandbox, spawns agent, records provenance.
2. **T=10m:** Agent finishes analyzing the schema. It sends an A2U envelope: `checkpoint: "Analysis complete. Plan generated. Awaiting approval to write scripts."` The user gets a notification on their phone during a meeting. They say "approve."
3. **T=45m:** Agent writes the migration scripts. It hits an uncertainty: "The `users` table has two email columns. Which is the canonical one?" It sends a `blocker`. The user gets an urgent haptic on their watch. They open the XR view, see the schema, point at the column, and say "this one."
4. **T=1h:** Agent runs the migration on staging. It sends a `checkpoint: "Migration successful on staging. Awaiting approval to run on prod."` The user is at their desk. They review the diff and say "approve."
5. **T=1h 5m:** Agent runs on prod. It sends `completion: "Migration complete. Auth service operational."` The user gets a quiet chime.

Throughout the entire process, the user was only bothered when a genuine decision was required. The agent handled the 99% of routine work autonomously.

## 6. The Provenance Invariant

The A2U protocol rests on one rule: **the agent never mutates state without an entry in the provenance log, and the provenance log is the source of truth for what happened and why.**

Every `executeImmediate`, every `checkpoint-approved`, every `constraint-violation` that got a yes—all of it is in the `ProvenanceStore` with a timestamp, a confidence score, and a causal link to the `DelegateIntent` that authorized the entire operation.

If anything goes wrong, the user can walk the provenance graph and see exactly which decision led to the problem, whether it was a human approval or an automatic execution, and what the agent's stated confidence was at that moment.

Trust in autonomous agents isn't built by making them infallible. It's built by making their reasoning transparent enough that you can catch mistakes early, understand why they happened, and fix them precisely—without having to throw away everything they did.

## Conclusion: The Coordination Runtime

With L7 Delegation, USIR evolves from an Interface Runtime into a **Coordination Runtime**. It coordinates not just user inputs and application APIs, but multiple asynchronous AI workers operating over hours or days.

The user becomes a manager of a team of agents, intervening only when necessary. The A2U protocol ensures the human remains meaningfully in control, even when they aren't watching.

---

**Next:** [Part 5: The Federated Semantic Web — L8 Collaboration Intents](./05-federated-semantic-web.md)
