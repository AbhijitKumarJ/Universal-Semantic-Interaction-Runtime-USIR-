# The Architecture of Intent, Part 7: Planners, Not Operators (Router & Executor)

*Engineering the Post-GUI Era — Part 7 of 14*

---

The most dangerous trend in modern AI engineering is the `while(true)` agent loop. 

Popularized by frameworks like AutoGPT and LangChain, the standard agentic architecture gives an LLM a list of tools and tells it to "think, act, observe" in a continuous, unmonitored loop. The LLM executes code, reads the output, realizes it made a mistake, executes more code to fix it, hallucinates a file path, deletes the wrong directory, and continues looping until it hits a token limit or destroys the user's workspace.

This is reckless systems design. 

Large Language Models are probabilistic text generators. They are exceptionally good at semantic translation and routing, but they are fundamentally incapable of deterministic, state-safe execution. 

The Universal Semantic Interaction Runtime (USIR) solves this by enforcing a strict architectural boundary: **LLMs never execute. They only plan.** 

In this post, we will tear open the `@usir/runtime` package to see how USIR isolates the LLM into a single-pass `LLMRouter`, generating JSON Directed Acyclic Graphs (DAGs) that are handed off to a rigid, TypeScript-based `TopologicalExecutor`.

### The Intent Router: One Pass, No Guessing

The `LLMRouter` is the *only* place in the entire USIR architecture that talks to an LLM. Its job is to ingest the `FusedIntent` (which we grounded with Interaction Memory in Part 6), look at the Tiered Semantic Snapshot, and output an `ExecutionPlan`.

To ensure the LLM stays in its lane, the system prompt relies on aggressive, negative constraints. Look at `packages/runtime/src/router/prompts.ts`:

```typescript
export const INTENT_ROUTER_SYSTEM_PROMPT = `You are the Intent Router for USIR (Universal Semantic Interaction Runtime).

You receive:
1. A SEMANTIC SNAPSHOT describing the current app state (entities, not pixels).
2. An INTERACTION MEMORY snapshot (recent entities, conversation history).
3. The user's raw instruction (voice transcript or text).

Your job is to return a JSON EXECUTION PLAN — a DAG of steps the deterministic executor will run.

CRITICAL RULES:
- You NEVER execute. You only PLAN.
- You NEVER guess when ambiguous. Use the "ambiguities" field to declare what you couldn't resolve.
- You MUST use only tools from the provided tool registry. Never invent tools.
- If confidence is below 0.7, you MUST declare ambiguities for the disambiguation UI.
- Prefer parallel execution when steps have no dependencies.
- Each step's args can include a sentinel "UNRESOLVED:fieldName" for ambiguous references — these will be resolved by the disambiguation UI.
`;
```

Notice the required JSON shape. It does not output a single function call. It outputs an array of `steps`, each containing a `dependsOn` array. 

If a user says, *"Rename this to `user_id` everywhere and run tests,"* the router generates a multi-step DAG:
1. Locate references.
2. Edit references (depends on 1).
3. Run tests (depends on 2).

By generating the entire plan Ahead-Of-Time (AOT), USIR can audit the intent, calculate its Trust Tier, and surface necessary approvals *before* a single byte of state is mutated.

### The Topological Executor: Deterministic Safety

Once the plan is generated (and any ambiguities are resolved via Collaborative Narrowing), it is handed to the `TopologicalExecutor`. 

This is where the magic happens. The executor treats the steps as a graph, using a variant of Kahn's algorithm to resolve dependencies and maximize parallelism.

Here is the core execution loop from `packages/runtime/src/executor/topological-executor.ts`:

```typescript
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
      return step.dependsOn.every((depId) => 
        completed.has(depId) || (step.optional && failed.has(depId))
      );
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
      this.onStepComplete?.(finished);
      
      if (finished.success) completed.add(finished.stepId);
      else failed.add(finished.stepId);
    }
  }
  // ... returns ExecutionResult
}
```

Because the runtime knows exactly which steps depend on which, it leverages `Promise.race` to execute independent branches concurrently. If step 1 fetches a database schema and step 2 fetches an API spec, they run simultaneously. 

**The Provenance Hook:** 
In Part 5, we explored L0.5 Provenance—the append-only ledger of *why* mutations happen. Because the LLM does not execute code, it cannot bypass this ledger. Inside `runStep()` (omitted above for brevity), the executor acts as the unbypassable chokepoint. It wraps every successful tool invocation, guaranteeing that a `ProvenanceNode` is committed to the `ProvenanceStore` linking the specific `intentId` to the `contentHashAfter`.

### Reliability Engineering: Retries and Circuit Breakers

Interacting with legacy software adapters (or federated P2P runtimes) means dealing with transient failures. The `TopologicalExecutor` brings enterprise-grade reliability to AI workflows by wrapping tool execution in two protective layers:

1. **Exponential Backoff with Jitter:** If an adapter fails (e.g., a file is temporarily locked), the executor automatically retries the specific DAG step, multiplying the delay by a `backoffFactor` and adding ±25% random jitter to prevent thundering herds on network tools.
2. **Per-Tool Circuit Breakers:** If a tool fails persistently, USIR trips a state-machine Circuit Breaker (`CLOSED` → `OPEN`).

If the breaker is `OPEN`, subsequent attempts to use that tool fail instantly, preventing the runtime from hanging for 30 seconds while an LLM fruitlessly tries to ping a dead capability. After a `cooldownMs` period, it shifts to `HALF_OPEN`, allowing a single probe request to test if the capability has recovered.

### The Critical Take: The Half-Failed DAG Problem

The inclusion of Circuit Breakers and DAG topologies makes USIR highly resilient at the systems level, but it exposes a glaring, unresolved flaw at the UX level.

Imagine an `ExecutionPlan` with 5 steps. Step 1 and 2 succeed. The state of the semantic graph is mutated (e.g., two files are renamed). 

Step 3 attempts to use a tool, but its Circuit Breaker is `OPEN`. Step 3 fast-fails. Because Steps 4 and 5 depend on Step 3, they are skipped. The `TopologicalExecutor` returns an `ExecutionResult` with `success: false`.

From an engineering perspective, the system functioned perfectly. From a user's perspective, they have been stranded in a fractured reality. 

Their semantic graph is now left in a half-mutated, inconsistent state. Because USIR tracks every change in the Provenance ledger (Part 5), the system has the cryptographic and semantic data required to execute a perfect topological rollback, undoing Steps 1 and 2 automatically. 

Yet, the current architecture simply halts and throws the error back to the user. There is no automated "Saga Pattern" compensation logic built into the executor, and no graceful "Rollback or Resume?" Waypoint surfaced to the user. Until the executor automatically leverages the Provenance graph to clean up its own failed DAGs, USIR's agentic execution remains too dangerous for unattended production workflows.

### What's Next

We have established how the runtime routes and executes plans deterministically. But we mentioned earlier that some plans are too dangerous to execute without human oversight.

In **Part 8**, we will tackle the core of AI safety. We will explore the **A2U (Agent-to-USIR) Protocol** and look at the 3-Tier Trust Gate that allows USIR to sandbox autonomous agents, ensuring they can work for hours in the background without ever executing a destructive action without your explicit cryptographic consent.

---
*Next:* **[Part 8: Agentic Sandboxes (The A2U Protocol)]**