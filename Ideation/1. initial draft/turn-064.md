# Turn 64 — USIR

> **USIR responded:**

# The Semantic Horizon, Part 4: Agentic Delegation — The L7 Intents and Asynchronous Graphs

Over the course of building the Universal Semantic Interaction Runtime (USIR), we have optimized fiercely for speed. From the 16ms Hot Tier to the instantaneous Visual Handshake, every architectural decision was designed to keep the user in a frictionless, synchronous flow state. 

But what happens when a task shouldn't be fast?

Imagine a developer says, *"Migrate the authentication database from PostgreSQL to DynamoDB."*

This is not a task you want the Intent Router to handle in a single sub-second execution loop. It requires reading hundreds of files, generating schemas, writing migration scripts, and running tests. It could take an hour. 

If USIR only supports synchronous, interactive execution, it is just a fast pair-programmer. To become a true operating system for the AI era, USIR must support **Autonomous Delegation**. It must be able to spawn independent "Worker Agents," hand them a massive task, and let them operate in the background.

In this post, we will expand USIR to support asynchronous operations using the **L7 Delegation Intents**, explore how to securely sandbox an agent's view of your Semantic Graph, and design the protocol for agents to report back for human approval.

---

### 1. The L7 Delegation Intents

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
  target: SemanticEntity | CognitiveReference; // The goal
  workerId?: string; // Optional: specify a particular agent profile
  constraints: string[]; // e.g., ["Do not mutate production config"]
}
```

When the user says *"Migrate the auth database,"* the Intent Router recognizes the scope of the request. Instead of mapping it to `ExecuteIntent`, it maps it to `DelegateIntent`.

### 2. The Sub-Graph Projection (Sandboxing the Agent)

When you hire a contractor to renovate your kitchen, you don't give them the keys to your car and your bank account. The same applies to AI agents.

In current agentic workflows (like AutoGPT or standard coding agents), the agent is given full read/write access to the entire repository and terminal. This is a massive security and stability risk. A hallucinating agent can delete the wrong directory or push broken code.

USIR solves this at the protocol level using **Sub-Graph Projections**.

Before the `TopologicalExecutor` spawns a Worker Agent, it dynamically creates a restricted version of the user's `SemanticSnapshot`. 

```typescript
// Conceptual code inside TopologicalExecutor.ts
async function spawnWorkerAgent(intent: DelegateIntent, snapshot: SemanticSnapshot) {
  
  // 1. Determine Required Scope based on the objective
  const requiredEntities = await determineScope(intent.target, intent.objective);
  // e.g., returns IDs for /src/auth/*, /db/schema.sql, and the test suite.

  // 2. Create the Sandbox Projection
  const sandboxSnapshot = {
    ...snapshot,
    entityGraph: restrictGraph(snapshot.entityGraph, requiredEntities)
  };

  // 3. Spawn the agent in a secure, isolated container
  const agent = new AutonomousWorker(sandboxSnapshot, intent.constraints);
  agent.start();
}
```

The Worker Agent literally cannot see the rest of the codebase. If it tries to navigate to a billing module or read an environment variable not included in the Sub-Graph Projection, the USIR adapter returns a 403. The agent is strictly bounded by semantic meaning, not just file permissions.

### 3. Asynchronous Execution and the A2U Protocol

Once the Worker Agent is spawned, it operates autonomously in the background. The user continues their day, interacting with their personal USIR instance without blocking.

But how does the agent report its progress? It doesn't modify the user's files directly, and it doesn't dump a massive block of text in a chat window. 

It uses the **Agent-to-USIR (A2U) Protocol**.

The Worker Agent behaves exactly like a human user. It generates `IntentEnvelopes` (e.g., `EditIntent`, `CreateIntent`) and sends them back to the user's main USIR runtime. However, because these intents come from an agent (actor: 'agent'), the `TopologicalExecutor` flags them as **Pending Approval**.

```json
{
  "intentId": "uuid-1234",
  "actor": "agent-worker-01",
  "intent": {
    "type": "intent.manipulation.edit",
    "target": "file:///src/auth/schema.ts",
    "instruction": "Replace Postgres types with DynamoDB schemas"
  },
  "status": "pending_approval"
}
```

### 4. Review via Collaborative Narrowing

When the Worker Agent finishes a logical chunk of work, the user's USIR instance notifies them via an L0 Meta Intent (e.g., a gentle chime and a notification: *"Auth migration phase 1 ready for review"*).

When the user focuses on the notification, USIR uses the exact same **Visual Handshake / Disambiguation UI** we built in Part 5 of the foundational series.

1.  **The Diff:** The UI highlights the `schema.ts` file. 
2.  **The Prompt:** The system asks: *"The agent wants to apply this schema change. Approve, Reject, or Discuss?"*
3.  **The Resolution:** 
    *   If the user says *"Approve"*, the `EditIntent` executes. 
    *   If the user says *"Reject"*, the intent is discarded, and the agent is notified of the failure.
    *   If the user says *"Why did you change the user ID type?"*, USIR initiates a synchronous L3 `ExplainIntent` loop with the agent to clarify the decision.

### The Sovereign Runtime

By introducing L7 Delegation Intents and the A2U Protocol, USIR graduates from a Copilot to a Manager. 

You, the human, remain the sovereign owner of the Semantic Graph. Worker Agents are spawned, sandboxed, and destroyed as needed. They operate asynchronously, reading from restricted projections, and they must petition your central runtime for permission to mutate state.

We have now built an architecture capable of translating legacy software, merging the physical and digital worlds, anticipating user needs, and managing autonomous swarms of agents. 

But there is one final frontier. What happens when it isn't just you and your agents? What happens when you need to work with other humans?

---
**Next up in the Finale, Part 5:** *The Federated Semantic Web — L8 Collaboration Intents.* We will explore how two different USIR instances sync their Semantic Snapshots over a peer-to-peer connection. We will unveil "Asymmetric Modality Collaboration," proving how a user driving a car (voice-only) and a user at a desk (XR/Keyboard) can pair-program on the exact same Semantic Graph in real-time, effectively ending the era of monolithic SaaS applications entirely.