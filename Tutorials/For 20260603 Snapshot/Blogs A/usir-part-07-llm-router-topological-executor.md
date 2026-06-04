# Part 7: The LLM Router and Topological Executor — Plans That Actually Execute

> **Series:** Decoding the Post-GUI Runtime — Act II: The Machine in Motion  
> **Previous:** [Part 6 — Interaction Memory: Teaching the Runtime to Forget Strategically](#)  
> **Next:** [Part 8 — The A2U Protocol: Keeping Humans in Control of Agents They're Not Watching](#)

---

USIR's most counter-intuitive design decision is this: **LLMs never execute anything.**

They plan. The `LLMRouter` converts a raw user instruction plus semantic context into a JSON DAG — an `ExecutionPlan`. Then a completely separate component, the `TopologicalExecutor`, runs that plan deterministically: in dependency order, with parallelism, retries, circuit breakers, and rollback hooks.

This split sounds like unnecessary complexity until you understand what it buys. Auditability: the plan is a first-class object that can be inspected, logged, and shown to the user before a single side effect occurs. Parallelism: steps without dependencies run concurrently without the LLM knowing or caring. Rollback: if step 4 of 6 fails, the executor walks backward through provenance and inverts the mutations. Trust enforcement: the `trustTier` on the plan tells the A2U protocol whether to ask for human approval before executing at all.

None of that is possible if the LLM is both planner and executor. Separation is the point.

This post goes implementation-deep on both components — the prompt engineering that shapes LLM output into a reliable DAG, and the executor mechanics that actually run it.

---

## The Architecture in One Diagram

```
User: "rename userId to user_id everywhere and run tests"
          │
          ▼
    ┌─────────────┐   snapshot + memory
    │  LLMRouter  │ ◄──────────────────── SemanticSnapshot (Hot + Warm tier)
    │             │                       InteractionMemorySnapshot
    └──────┬──────┘
           │ ExecutionPlan (JSON DAG)
           ▼
    ┌──────────────────────────────────────┐
    │         ExecutionPlan                │
    │  step-1: locate("userId usages")  ──┐│
    │  step-2: select(all)     dependsOn:1││  ← parallel batch 1
    │  step-3: edit(rename)    dependsOn:2││
    │  step-4: run(tests)      dependsOn:3│┘  ← sequential batch 2
    └──────┬───────────────────────────────┘
           │
           ▼
    ┌─────────────────────┐
    │  TopologicalExecutor│
    │  - Kahn sort        │
    │  - Parallel launch  │
    │  - Retry + backoff  │
    │  - Circuit breakers │
    │  - UNRESOLVED guard │
    └──────────┬──────────┘
               │ ExecutionResult
               ▼
         ToolRegistry → actual VS Code / browser / federated tools
```

---

## Part 1: The LLM Router

### What It Receives

The `LLMRouter.route()` method takes three inputs:

```typescript
// packages/runtime/src/router/llm-router.ts

public async route(args: {
  rawInstruction: string;        // "rename userId to user_id everywhere and run tests"
  snapshot: SemanticSnapshot;    // Current state of the environment
  memory: InteractionMemorySnapshot;  // What the user has been touching
}): Promise<ExecutionPlan>
```

Before calling the LLM, it fetches two more pieces in parallel:

```typescript
const [toolRegistryJson, availableEntityIds] = await Promise.all([
  this.deps.getToolRegistryJson(),   // What tools can actually be invoked
  this.deps.getAvailableEntityIds(), // What entities currently exist in the graph
]);
```

This parallel fetch matters. The tool registry is the ground truth for what the LLM is *allowed* to emit — the system prompt explicitly forbids inventing tools. The available entity IDs are the ground truth for what targets are *addressable* — any entity ID the LLM emits must come from this list, or it must use the `UNRESOLVED:` sentinel.

The snapshot is stripped before being sent:

```typescript
private stripHotSnapshotForPrompt(snapshot: SemanticSnapshot) {
  return {
    activeRegion: snapshot.hot.activeRegion,
    activeEntityId: snapshot.hot.activeEntity.id,
    activeEntityDisplayName: snapshot.hot.activeEntity.displayName,
    activeEntityRole: snapshot.hot.activeEntity.role,
    selections: snapshot.hot.selections.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      role: s.role,
    })),
    ephemeral: snapshot.hot.ephemeral,
  };
}
```

Only the Hot tier — cursor position, active entity, current selections — goes into the prompt. The Warm tier (visible entities, panel layout) and Cold tier (full LSP graph) are *not* included. This is a deliberate token budget decision: the Hot tier is what the LLM needs to resolve "this," "that," and "the selected function." The rest is graph detail the executor doesn't need for planning.

### The System Prompt: Encoding the Rules

The system prompt is the most important engineering artifact in the router. It's short — fewer than 25 lines — but every sentence is load-bearing:

```
You are the Intent Router for USIR (Universal Semantic Interaction Runtime).

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
- Each step's args can include a sentinel "UNRESOLVED:fieldName" for ambiguous references —
  these will be resolved by the disambiguation UI.

Output JSON shape (strict):
{
  "detectedIntentType": "intent.manipulation.edit",
  "confidence": 0.82,
  "steps": [
    {
      "stepId": "step-1",
      "tool": "vscode.openEntity",
      "args": { "entityId": "file:///src/main.ts" },
      "dependsOn": [],
      "optional": false,
      "confidence": 0.95
    }
  ],
  "ambiguities": []
}
```

Three rules deserve close attention.

**"You NEVER execute. You only PLAN."** This isn't metaphysical. It's a guard against a class of LLM behavior called *tool call leakage* — where a model trained on function-calling datasets starts executing steps in its reasoning trace rather than declaring them as plan nodes. The rule forces the model to treat every action as a declaration in a data structure, not as something to perform.

**"You NEVER guess when ambiguous."** The 0.7 confidence threshold is the trigger for the disambiguation waypoint system built in Part 6. An LLM instructed to "do its best" will pick a candidate and proceed; an LLM instructed to "declare ambiguity below 0.7" will emit an `ambiguities` array that surfaces a disambiguation UI instead of silently doing the wrong thing. The rule shifts the failure mode from silent wrong action to explicit human query.

**"You MUST use only tools from the provided tool registry."** This is tool hallucination prevention. LLMs trained on code will happily invent `vscode.renameSymbolInAllFiles()` if they think it should exist. The registry constraint means the plan can only contain tools the executor knows how to run. If the right tool doesn't exist, the LLM must declare that in `ambiguities` — which is the correct behavior.

### Why temperature=0 Is Non-Negotiable

The config interface says it plainly:

```typescript
export interface LLMRouterConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature?: number;   // 0 recommended for deterministic plans
  maxTokens?: number;
}
```

With `temperature > 0`, the same instruction in the same context can produce different plans on different calls. That's a desirable property for creative generation. It is a catastrophic property for a system that routes mutations to production code. At `temperature=0`, the LLM is greedy-deterministic: given identical inputs, it produces identical outputs. Plans become reproducible, debuggable, and testable. The tradeoff — slightly lower quality on ambiguous phrasings — is worth it.

The `response_format: { type: 'json_object' }` parameter in the OpenAI-compatible call is the other half of this constraint. It forces JSON output at the model level, preventing preambles ("Sure! Here's the plan:") that would break the `parseAndValidate` step.

### Trust Tier Classification

One subtle but important thing the router does on every plan is classify a trust tier:

```typescript
private classifyTrustTier(plan: any): 1 | 2 | 3 {
  const intentType: string = plan.detectedIntentType ?? '';
  if (intentType.includes('.information.') || intentType.includes('.navigation.')) return 1;
  if (intentType.includes('.manipulation.') || intentType.includes('.creation.'))   return 2;
  if (
    intentType.includes('.execution.') ||
    intentType.includes('.collaboration.') ||
    intentType.includes('.delegation.')
  ) return 3;
  return 2;  // Safe default
}
```

The three tiers map directly to the A2U protocol (covered in Part 8): Tier 1 is read-only and executes without asking. Tier 2 is reversible mutations — the executor checkpoints before running and shows a diff. Tier 3 is irreversible (run, delete, share, delegate) — the executor halts and requires explicit human approval.

The router classifies by `detectedIntentType`, which uses the intent ontology's `intent.<layer>.<verb>` string encoding. Navigation and information are always read-only. Manipulation and creation are reversible mutations. Execution, collaboration, and delegation are irreversible or cross-system. The classification is string-contains rather than an exact match, which makes it robust to minor ontology additions without requiring a schema update.

---

## Part 2: The ExecutionPlan — A JSON DAG

The LLM's output is validated into an `ExecutionPlan`:

```typescript
// packages/runtime/src/router/types.ts

export interface ExecutionStep {
  stepId: string;
  tool: string;                      // Must match a registered tool name
  args: Record<string, unknown>;     // May contain "UNRESOLVED:xxx" sentinels
  dependsOn: string[];               // Other stepIds this step waits for
  optional: boolean;                 // If true, failure won't abort the plan
  confidence: number;                // LLM's per-step confidence, 0–1
}

export interface ExecutionPlan {
  planId: string;
  rawInstruction: string;
  steps: ExecutionStep[];
  ambiguities: Ambiguity[];          // What the LLM couldn't resolve
  confidence: number;                // Overall plan confidence
  detectedIntentType: string;        // e.g. "intent.manipulation.edit"
  createdAt: number;
  trustTier: 1 | 2 | 3;
}
```

The `dependsOn` field is what makes this a DAG. A step with `dependsOn: []` can run immediately. A step with `dependsOn: ['step-1', 'step-2']` waits until both `step-1` and `step-2` have completed successfully.

For the "rename everywhere and run tests" example, the plan might look like:

```json
{
  "planId": "plan-1749001234-k2j8xq",
  "rawInstruction": "rename userId to user_id everywhere and run tests",
  "detectedIntentType": "intent.manipulation.edit",
  "confidence": 0.91,
  "trustTier": 2,
  "steps": [
    {
      "stepId": "step-1",
      "tool": "vscode.locateSymbolUsages",
      "args": { "symbolName": "userId" },
      "dependsOn": [],
      "optional": false,
      "confidence": 0.97
    },
    {
      "stepId": "step-2",
      "tool": "vscode.selectAll",
      "args": { "sourceStepId": "step-1" },
      "dependsOn": ["step-1"],
      "optional": false,
      "confidence": 0.95
    },
    {
      "stepId": "step-3",
      "tool": "vscode.renameSymbol",
      "args": { "from": "userId", "to": "user_id" },
      "dependsOn": ["step-2"],
      "optional": false,
      "confidence": 0.93
    },
    {
      "stepId": "step-4",
      "tool": "vscode.runTests",
      "args": { "scope": "all" },
      "dependsOn": ["step-3"],
      "optional": false,
      "confidence": 0.88
    }
  ],
  "ambiguities": []
}
```

This is a sequential plan — each step depends on the previous — because the rename must complete before tests can verify it. For a command like "open the config file and the main entry point," steps would have `dependsOn: []` on both, enabling parallel execution.

The `UNRESOLVED:` sentinel is the mechanism for explicit ambiguity. If the LLM cannot uniquely identify a target entity, it emits something like:

```json
{
  "stepId": "step-1",
  "tool": "vscode.openEntity",
  "args": { "entityId": "UNRESOLVED:which-validator" },
  "dependsOn": [],
  "optional": false,
  "confidence": 0.55
}
```

Combined with an `ambiguities` entry that describes the candidates, this is the trigger for the disambiguation waypoint. The executor will refuse to run any step whose args still contain `UNRESOLVED:` — they must be filled in by the human before execution proceeds.

---

## Part 3: The Topological Executor

### The Core Loop: Kahn's Algorithm Without the Textbook Ceremony

The executor's main loop implements topological ordering without pre-sorting. Instead of computing a full topological sort upfront (which would require the whole graph to be valid before starting), it uses a reactive approach: on each iteration, find all steps whose dependencies are satisfied and launch them all in parallel.

```typescript
// packages/runtime/src/executor/topological-executor.ts

public async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
  const start = Date.now();
  const stepResults = new Map<string, StepResult>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<StepResult>>();

  while (completed.size + failed.size < plan.steps.length) {
    // Find ready steps: deps satisfied, not already running or done
    const ready = plan.steps.filter((step) => {
      if (completed.has(step.stepId) || failed.has(step.stepId) || inFlight.has(step.stepId)) {
        return false;
      }
      return step.dependsOn.every(
        (depId) => completed.has(depId) || (step.optional && failed.has(depId))
      );
    });

    if (ready.length === 0 && inFlight.size === 0) break; // Deadlock guard

    // Launch ALL ready steps concurrently
    for (const step of ready) {
      const promise = this.runStep(step, stepResults);
      inFlight.set(step.stepId, promise);
    }

    // Wait for the FIRST one to finish, then loop
    if (inFlight.size > 0) {
      const finished = await Promise.race(inFlight.values());
      inFlight.delete(finished.stepId);
      stepResults.set(finished.stepId, finished);
      this.onStepComplete?.(finished);
      if (finished.success) {
        completed.add(finished.stepId);
      } else {
        failed.add(finished.stepId);
      }
    }
  }
  // ...
}
```

The key insight is `Promise.race(inFlight.values())`. The executor doesn't wait for *all* in-flight steps — it waits for *any one* to complete, then immediately re-evaluates which new steps are now ready. This means:

- If steps A and B are both in-flight (parallel), and B finishes first, C (which depends on B) starts immediately — without waiting for A.
- Maximum parallelism is achieved without any upfront scheduling. The ready-check loop handles it naturally.

The `optional` flag introduces partial-failure tolerance. A step marked `optional: true` with a dependency on a failed step will still be considered eligible for execution (the `|| (step.optional && failed.has(depId))` check). This allows "best-effort" steps — like updating a UI preview — to run even when a preceding optional step failed, without aborting the whole plan.

### Retry Logic: Backoff with Jitter

Each step runs inside `runStep()`, which wraps the tool call in a retry loop:

```typescript
private async runStep(step: ExecutionStep, previousResults: Map<string, StepResult>): Promise<StepResult> {
  const breaker = this.getOrCreateBreaker(step.tool);
  if (!breaker.allowRequest()) {
    return {
      stepId: step.stepId,
      success: false,
      error: `Circuit breaker OPEN for tool '${step.tool}' — failing fast`,
      durationMs: 0,
      affectedEntityIds: [],
      provenanceId: `provenance-cb-${step.stepId}`,
      retryCount: 0,
      circuitBreakerTripped: true,
    };
  }

  let lastError: unknown;
  let retryCount = 0;

  for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = computeBackoff(attempt - 1, this.retryConfig);
      await sleep(delay);
    }
    try {
      const tool = this.toolRegistry.getTool(step.tool);
      if (!tool) throw new Error(`Tool not found in registry: ${step.tool}`);
      const resolvedArgs = this.resolveArgs(step.args, previousResults);
      const output = await tool.execute(resolvedArgs);
      breaker.recordSuccess();
      return { stepId: step.stepId, success: true, output, /* ... */ };
    } catch (err) {
      lastError = err;
      retryCount = attempt + 1;
      if (!isRetryable(err) || attempt >= this.retryConfig.maxRetries) break;
    }
  }

  breaker.recordFailure();
  return { stepId: step.stepId, success: false, error: /* lastError */, retryCount, /* ... */ };
}
```

The backoff function adds ±25% jitter to prevent retry storms when many steps fail at the same time:

```typescript
function computeBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffFactor, attempt);
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, config.maxDelayMs);
}
```

With defaults of `baseDelayMs: 100`, `backoffFactor: 2`, `maxDelayMs: 5000`, the backoff sequence is roughly: 100ms, 200ms, 400ms, 800ms... capped at 5 seconds. Three retries max. The jitter spreads those retries across a ±25% window, so two tools retrying simultaneously won't both hammer a flaky service at the identical millisecond.

The `isRetryable` function is an important gate:

```typescript
function isRetryable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('not found in registry')) return false;  // Logic error — retrying won't help
  if (msg.includes('UNRESOLVED:')) return false;             // Disambiguation needed — retrying won't help
  return true;
}
```

Logical errors — missing tool registration, unresolved argument sentinels — are non-retryable by definition. Retrying `"UNRESOLVED:which-file"` three times will produce the same error three times. The guard prevents that waste and surfaces the real problem: disambiguation wasn't completed before execution was invoked.

The test suite is explicit about this contract:

```typescript
// packages/runtime/src/executor/topological-executor.test.ts

it('does NOT retry non-retryable errors (tool not found)', async () => {
  const result = await exec.execute(plan_with_unregistered_tool);
  expect(result.success).toBe(false);
  expect(result.stepResults[0].error).toContain('not found');
  // fn called exactly once — no retries
});

it('retries on transient failure and succeeds', async () => {
  // fn rejects twice, then resolves
  const result = await exec.execute(plan);
  expect(result.success).toBe(true);
  expect(fn).toHaveBeenCalledTimes(3);  // initial + 2 retries
  expect(result.stepResults[0].retryCount).toBe(2);
});
```

### The Circuit Breaker: CLOSED → OPEN → HALF_OPEN

The executor maintains a per-tool `CircuitBreaker` instance. A tool that consistently fails doesn't get retried indefinitely — the breaker trips after a threshold, then enforces a cooldown before allowing probe requests.

```typescript
// packages/runtime/src/executor/circuit-breaker.ts

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerOptions = {
  threshold: 5,             // Open after 5 failures
  cooldownMs: 30_000,       // 30-second cooldown
  halfOpenMaxRequests: 1,   // 1 probe request in HALF_OPEN
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAccepted = 0;

  allowRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.options.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenAccepted = 0;
        this.halfOpenAccepted++;
        return true;  // Allow the probe
      }
      return false;   // Still in cooldown
    }
    // HALF_OPEN — allow limited probes
    if (this.halfOpenAccepted < this.options.halfOpenMaxRequests) {
      this.halfOpenAccepted++;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') this.state = 'CLOSED'; // Probe succeeded — fully recover
    this.failureCount = 0;
    this.halfOpenAccepted = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.options.threshold) this.state = 'OPEN';
    else if (this.state === 'HALF_OPEN') this.state = 'OPEN'; // Probe failed — re-open
  }
}
```

The state machine has three transitions:

```
CLOSED ──(threshold failures)──► OPEN ──(cooldown expires)──► HALF_OPEN
  ▲                                                                  │
  └──────────────────(probe succeeds)──────────────────────────────┘
                                         │
           OPEN ◄──(probe fails)─────────┘
```

In the executor, a `circuitBreakerTripped: true` flag in the `StepResult` marks which steps were fast-failed by the breaker (as opposed to failing due to retryable errors). The test coverage here is precise:

```typescript
it('trips after threshold failures and fails fast on next execute', async () => {
  // threshold: 2 — two failures OPEN the breaker
  await exec.execute(plan_1); // fails — failureCount: 1
  await exec.execute(plan_2); // fails — failureCount: 2, state: OPEN
  expect(fn).toHaveBeenCalledTimes(2);

  const r3 = await exec.execute(plan_3);
  expect(r3.stepResults[0].circuitBreakerTripped).toBe(true);
  expect(r3.stepResults[0].error).toContain('Circuit breaker OPEN');
  expect(fn).toHaveBeenCalledTimes(2); // fn NOT called — fast-failed
});

it('recovers after cooldown when tool starts succeeding', async () => {
  // Two failures OPEN the breaker
  // Advance fake timers 1100ms past cooldown
  vi.advanceTimersByTime(1_100);
  // HALF_OPEN probe succeeds — breaker CLOSES
  const result = await exec.execute(plan_3);
  expect(result.success).toBe(true);
});
```

The circuit breaker is per-tool and per-executor instance. Two different `TopologicalExecutor` instances (e.g., one for VS Code, one for a browser adapter) maintain independent breaker state. `resetCircuitBreakers()` clears all breakers — useful for test teardown, or for a "force retry" user action.

### The UNRESOLVED Guard

One more safety rail deserves attention. The `resolveArgs` method checks for lingering `UNRESOLVED:` sentinels at execution time:

```typescript
private resolveArgs(
  args: Record<string, unknown>,
  previousResults: Map<string, StepResult>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith('UNRESOLVED:')) {
      // The disambiguation UI should have filled this in before execution.
      // If it reaches here, it's a runtime error.
      throw new Error(`Unresolved argument at execution time: ${value}`);
    }
    resolved[key] = value;
  }
  return resolved;
}
```

The contract is: any `UNRESOLVED:` sentinel must be replaced by a concrete value by the disambiguation UI *before* `execute()` is called. If an `UNRESOLVED:` reaches `resolveArgs`, it means the execution pipeline was invoked prematurely — before the user responded to a disambiguation waypoint. The throw is the right behavior: it fails the step, surfaces a clear error message, and marks the step as non-retryable.

This is a defense-in-depth check. The primary guard is at the A2U trust protocol level (Part 8), which checks for ambiguities in the plan before dispatching execution at all. But `resolveArgs` is the last line of defense — the failsafe that catches any case where that check was bypassed.

---

## The Tool Interface: Making Local and Remote Interchangeable

Every registered tool implements the same minimal contract:

```typescript
// From packages/runtime/src/disambiguation/collaborative-narrowing.ts

export interface Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
```

One method. One signature. The executor doesn't know and doesn't care whether `tool.execute()` calls a VS Code API, mutates a browser DOM node, or makes a WebRTC call to a federated peer runtime in another process. The `ToolRegistry` is an in-process `Map<string, Tool>` — but the federation bridge populates it with remote tools:

```typescript
// From packages/runtime/src/federation-bridge.ts

const l8Tools = federatedRuntime.components.l8Tools.getAllTools();
for (const tool of l8Tools) {
  toolRegistry.register({
    name: tool.name,
    description: tool.description,
    execute: tool.execute,  // Wraps a WebRTC message exchange
  });
}
```

From the executor's perspective, `vscode.renameSymbol` and `remote-peer-1234.renameSymbol` are identical. The federation complexity is fully hidden behind the `execute` function. This is the right abstraction boundary: the executor is a DAG runner, not a network manager.

The `StepResult` carries two fields that tie back to the provenance system:

```typescript
export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  affectedEntityIds: string[];   // What entities were changed
  provenanceId: string;          // Links this step to the ProvenanceStore
  retryCount?: number;
  circuitBreakerTripped?: boolean;
}
```

`affectedEntityIds` is extracted from the tool's output via `extractAffectedEntities()`. `provenanceId` is extracted via `extractProvenanceId()`. These two fields are the executor's contribution to the provenance chain built in Part 5. Every completed step produces a provenance node; every failed step produces a failed provenance node. The full plan execution — parallel, retried, partially-failed — is reconstructable from the provenance store.

---

## The Rollback Path

The spec calls for rollback: if step 4 of 6 fails, the executor walks the provenance chain backward from the failure point and inverts mutations using `contentHashBefore` fields from `ProvenanceNode`.

The `StepResult.provenanceId` field is the hook. Each successful step records a provenance node (in the `ProvenanceStore` from Part 5) with `contentHashBefore` and `contentHashAfter`. A rollback operation would:

1. Collect all `provenanceId`s from successful `StepResult`s in the failed plan.
2. Walk the `ProvenanceStore` backward from the failure point, ordered by `createdAt`.
3. For each node, use `contentHashBefore` to restore the pre-mutation state.

The infrastructure is in place: `ProvenanceStore` has `walkCausalChain()` and the hash fields exist on `ProvenanceNode`. The executor produces `provenanceId` on every result. But the rollback driver — the code that actually invokes tool-level inverse operations using those provenance hashes — is not yet implemented in the executor itself. It's the next logical step in the implementation roadmap.

---

## Critical Take: What the Circuit Breaker Gets Right and What It Leaves Unresolved

The circuit breaker is an excellent addition to a planning runtime. Its presence signals that USIR's authors have thought past the happy path — that tools fail, that failures cluster, and that a naive retry loop can make a bad situation catastrophically worse by hammering a degraded service.

But the breaker opens a UX problem that the current implementation doesn't fully resolve.

Consider this plan: five steps, step 4 depends on step 3, step 5 depends on step 4. Steps 1–3 execute successfully, modifying files in the workspace. Step 4 calls a tool whose circuit breaker is OPEN — it fast-fails with `circuitBreakerTripped: true`. Step 5 is never attempted because its dependency failed.

The `ExecutionResult` reports `success: false` with `failedStepIds: ['step-4', 'step-5']`. Steps 1–3 have been applied — the workspace has been mutated. The user is now in a half-executed state.

The current code doesn't automatically roll back steps 1–3. The `onStepComplete` callback fires with each `StepResult`, but there's no built-in "on plan failure, roll back all successful steps" behavior. A caller could implement this using the provenance IDs in the successful step results, but nothing enforces it.

What makes this UX-difficult is the checkpoint UI. The A2U protocol (Part 8) shows the user a diff before executing Tier 2 plans. They approve. The plan starts. Three steps execute. Then a circuit breaker kills the last two. The workspace is now in a state the user approved but the system never completed. The diff they saw is only partially applied.

The right fix is plan-level atomicity: either the plan commits in full, or it rolls back to the pre-plan state. That requires the rollback driver mentioned above — specifically, a `rollbackOnFailure` option in the executor that, when set, automatically inverts all successful steps if any required step fails. The `optional: true` flag on `ExecutionStep` already handles the "tolerate failure of this specific step" case; what's missing is the full-plan atomic semantics for the `optional: false` majority.

Until rollback is implemented, the circuit breaker is a latency protection mechanism (it prevents hammering flaky tools) but not a state protection mechanism (it doesn't prevent partial mutations). Both are needed. USIR currently has one.

---

## What's Next

[Part 8 — The A2U Protocol](#) addresses the question the executor leaves open: *who decides whether the plan runs at all?* The trust tier classification built in the router feeds into the A2U (Agent-to-USIR) dispatch layer — a 3-tier gate with 4 urgency levels that keeps humans in the loop for irreversible actions. The executor is the *how*. A2U is the *whether*.

---

*This post is part of the **Decoding the Post-GUI Runtime** series — a 14-part technical deep-dive into the Universal Semantic Interaction Runtime. All code excerpts are from the USIR repository as of its current pre-alpha state.*
