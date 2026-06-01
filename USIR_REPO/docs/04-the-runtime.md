# Beyond the GUI, Part 4: The Runtime — Giving AI a Memory and a Topo-Executor

In [Part 3](./03-the-adapter-layer.md), we built the Adapter Layer, transforming the raw, chaotic state of an application into a pristine, event-driven `SemanticSnapshot`. We now have a live graph of meaning.

But a snapshot is just a frozen moment in time. Human-computer interaction is an ongoing dialogue. When a developer says, *"Explain this function,"* and then follows up with, *"Okay, now move it to the **previous** file,"* an LLM looking only at the current snapshot will fail catastrophically. It has no idea what "previous" means.

Current AI assistants try to solve this by dumping the entire chat history into the context window. This is expensive, slow, and highly prone to hallucination.

In this post, we will build the brain of the Universal Semantic Interaction Runtime (USIR): **`@usir/runtime`**. We will give our system a structured memory, design an Intent Router that extracts commands in a single pass, and build a Topological Executor that guarantees safe, deterministic execution.

## 1. Interaction Memory: Solving "It" and "That"

Humans use cognitive shortcuts—pronouns—constantly. We do this because establishing shared context is faster than explicitly naming targets every time. For an AI to feel like a seamless ambient co-pilot, it must natively resolve these cognitive references.

We solve this using `InteractionMemory.ts`, a module that sits outside the LLM and manages state across time and space.

```typescript
export class InteractionMemory {
  private history: string[] = []; // Ring buffer of recently accessed Entity IDs
  private lastDiscussed: string | null = null; // The "it"
  private conversationHistory: ConversationTurn[] = [];

  public pushToHistory(entityId: string, options?: { intentId?: string; rawInput?: string }): void {
    this.history = this.history.filter((id) => id !== entityId);
    this.history.unshift(entityId); // Move to front
    if (this.history.length > 50) this.history.pop();
    this.lastDiscussed = entityId;
  }

  public resolve(reference: CognitiveReference, candidates: SemanticEntity[]): string | null {
    switch (reference.kind) {
      case 'temporal':     return this.resolveTemporal(reference);
      case 'conversational': return this.resolveConversational(reference);
      case 'spatial':      return this.resolveSpatial(reference, candidates);
      case 'semantic':     return this.resolveSemantic(reference, candidates);
    }
  }
}
```

The `history` is a ring buffer of the 50 most recently referenced entities. When the user says "the previous one," the resolver returns `history[1]`. When they say "the thing below it," the resolver finds the anchor entity from history, calculates the spatial relationship, and returns the matching candidate.

The four kinds of references each have a dedicated resolver:
- **Temporal:** "the file I opened yesterday" → indexed by event type
- **Conversational:** "the previous one" → `history[1]`
- **Spatial:** "the thing below that" → anchor + direction
- **Semantic:** "the design discussion" → embedding search over `displayName` and `role`

## 2. The Intent Router: One-Pass Plan Extraction

The router is the *only* place in USIR that talks to an LLM. Its job is to take a raw user instruction + a snapshot + memory state, and produce a structured `ExecutionPlan` in a single LLM call.

The prompt engineering is critical. We explicitly forbid the LLM from guessing:

```typescript
export const INTENT_ROUTER_SYSTEM_PROMPT = `You are the Intent Router for USIR.

CRITICAL RULES:
- You NEVER execute. You only PLAN.
- You NEVER guess when ambiguous. Use the "ambiguities" field.
- You MUST use only tools from the provided tool registry.
- If confidence is below 0.7, you MUST declare ambiguities.
- Prefer parallel execution when steps have no dependencies.

Output JSON shape (strict):
{
  "detectedIntentType": "intent.manipulation.edit",
  "confidence": 0.82,
  "steps": [{ "stepId": "step-1", "tool": "vscode.openEntity", ... }],
  "ambiguities": []
}`;
```

The router sends:
- The Hot tier (small, always included)
- The Interaction Memory snapshot
- The tool registry (so the LLM knows what's available)
- A list of available entity IDs (so the LLM doesn't hallucinate)

In return, it gets a strict JSON `ExecutionPlan`. The LLM is *not* told to be creative. It is told to be *precise*.

```typescript
export interface ExecutionPlan {
  planId: string;
  rawInstruction: string;
  steps: ExecutionStep[];
  ambiguities: Ambiguity[];
  confidence: number;
  detectedIntentType: string;
  trustTier: 1 | 2 | 3;
  createdAt: number;
}

export interface ExecutionStep {
  stepId: string;
  tool: string;          // e.g. "vscode.openEntity"
  args: Record<string, unknown>;
  dependsOn: string[];   // DAG edges
  optional: boolean;
  confidence: number;
}
```

The `dependsOn` array is what makes this powerful. The LLM can say "step 2 depends on step 1 completing first." The executor can then run independent steps in parallel.

## 3. The Topological Executor: Safe, Auditable Execution

The LLM does not execute. It plans. The runtime executes. This separation is the **single most important safety property** of USIR.

```typescript
export class TopologicalExecutor {
  public async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const stepResults = new Map<string, StepResult>();
    const completed = new Set<string>();
    const failed = new Set<string>();
    const inFlight = new Map<string, Promise<StepResult>>();

    while (completed.size + failed.size < plan.steps.length) {
      // Find ready steps (deps satisfied, not yet running or done)
      const ready = plan.steps.filter((step) => {
        if (completed.has(step.stepId) || failed.has(step.stepId) || inFlight.has(step.stepId)) {
          return false;
        }
        return step.dependsOn.every((depId) => completed.has(depId) || (step.optional && failed.has(depId)));
      });

      // Launch all ready steps in parallel
      for (const step of ready) {
        const promise = this.runStep(step, stepResults);
        inFlight.set(step.stepId, promise);
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        const finished = await Promise.race(inFlight.values());
        inFlight.delete(finished.stepId);
        stepResults.set(finished.stepId, finished);
        if (finished.success) completed.add(finished.stepId);
        else failed.add(finished.stepId);
      }
    }

    return {
      planId: plan.planId,
      success: failed.size === 0,
      stepResults: Array.from(stepResults.values()),
      totalDurationMs: Date.now() - start,
      failedStepIds: Array.from(failed),
    };
  }
}
```

The executor:
- Runs steps in **dependency order**
- **Parallelizes** independent steps via `Promise.race`
- **Isolates** failures: a failed `optional` step doesn't abort the plan
- **Records** every step's result, including duration and affected entities

The result is a complete audit log of what happened. Combined with the `ProvenanceStore`, every mutation in the user's workspace is traceable back to the intent that caused it, the LLM confidence at the time, and the human (or agent) who authorized it.

## 4. Trust Tiers: Making Agents Safe

The runtime doesn't trust agents the same way it trusts users. The `TrustClassifier` enforces a 3-tier policy:

```typescript
export class TrustClassifier {
  classify(intent: BaseIntent, agentConfidence?: number): TrustTier {
    const conf = agentConfidence ?? 1.0;
    switch (intent.type) {
      case 'intent.information.explain':
      case 'intent.navigation.locate':
        return { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };

      case 'intent.manipulation.edit':
      case 'intent.manipulation.create':
        return {
          tier: 2,
          requiresApproval: conf < 0.85,
          logToProvenance: true,
          reversible: true,
        };

      case 'intent.manipulation.delete':
      case 'intent.execution.run':
      case 'intent.collaboration.share':
        return { tier: 3, requiresApproval: true, logToProvenance: true, reversible: false };
    }
  }
}
```

- **Tier 1** (read-only): the agent can do it without asking
- **Tier 2** (reversible): the agent can proceed if confidence is above 0.85, else checkpoint
- **Tier 3** (irreversible): always requires explicit human approval

This is enforced *before* execution. A misbehaving agent that tries to issue a `delete` without human approval will hit the A2U dispatcher and get blocked.

## What's Next

We have a memory, a router, an executor, and a trust model. But what happens when the LLM can't resolve a target uniquely? When the user says "the function I was editing" and there are three candidates? In [Part 5](./05-collaborative-narrowing.md), we will cover Collaborative Narrowing: the disambiguation paradigm where ambiguity is a feature, not an error.

---

**Next:** [Part 5: Collaborative Narrowing — The End of "AI Hallucination" in UX](./05-collaborative-narrowing.md)
