# Turn 48 — USIR

> **USIR responded:**

# Beyond the GUI, Part 4: The Runtime — Giving AI a Memory and a Topo-Executor

In Part 3, we built the Adapter Layer, transforming the raw, chaotic state of an application into a pristine, event-driven `SemanticSnapshot`. We now have a live graph of meaning. 

But a snapshot is just a frozen moment in time. Human-computer interaction is an ongoing dialogue. When a developer says, *"Explain this function,"* and then follows up with, *"Okay, now move it to the **previous** file,"* an LLM looking only at the current snapshot will fail catastrophically. It has no idea what "previous" means.

Current AI assistants try to solve this by dumping the entire chat history into the context window. This is expensive, slow, and highly prone to hallucination. 

In this post, we will build the brain of the Universal Semantic Interaction Runtime (USIR): **`@usir/runtime`**. We will give our system a structured memory, design an Intent Router that extracts commands in a single pass, and build a Topological Executor that guarantees safe, deterministic execution.

---

### 1. Interaction Memory: Solving "It" and "That"
Humans use cognitive shortcuts—pronouns—constantly. We do this because establishing shared context is faster than explicitly naming targets every time. For an AI to feel like a seamless ambient co-pilot, it must natively resolve these cognitive references.

We solve this using `InteractionMemory.ts`, a module that sits outside the LLM and manages state across time and space.

```typescript
export class InteractionMemory {
  private history: string[] = []; // Ring buffer of recently accessed Entity IDs
  private lastDiscussed: string | null = null; // The "it"

  public pushToHistory(entityId: string) {
    this.history = this.history.filter(id => id !== entityId);
    this.history.unshift(entityId); // Move to front
    if (this.history.length > 50) this.history.pop();
    this.lastDiscussed = entityId;
  }
}
```
Whenever the adapter reports a change in focus (the user clicks a new file, or the AI highlights a new function), `pushToHistory` is called.

When the LLM encounters a pronoun, it doesn't try to guess. It outputs a `target: 'previous'` payload. The runtime intercepts this and queries the memory:

```typescript
// Resolving "the previous file"
if (ref === 'previous') {
  const activeId = snapshot.hot.activeEntityId;
  const previousId = this.history.find(id => id !== activeId);
  return snapshot.entityGraph[previousId]; 
}
```
This applies to spatial references too. If the user says, *"Run the test **below** that,"* the runtime uses the spatial bounds embedded in the `SemanticSnapshot` to perform a geometric calculation, returning the closest entity beneath the active one.

By offloading memory from the LLM’s context window into a deterministic state machine, we drastically reduce token costs and eliminate reference hallucinations.

### 2. The Single-Pass Intent Router
The Intent Router is where natural language meets machine logic. Its job is to take the user's voice command, look at the Semantic Snapshot, and output a structured execution plan.

A naive design would use two LLM calls:
1. "What is the user's intent?" (Output: *Edit*)
2. "What are the parameters for Edit?" (Output: *file, line, text*)

This doubles latency. For an agentic UI to feel native, latency must be sub-second. Therefore, classification and parameter extraction must happen in **one pass**.

Here is how we structure the system prompt in `IntentRouter.ts`:

```text
You are a Universal Semantic Intent Router.
You receive:
- The user's input (voice/text)
- A Semantic Snapshot (Active cursor, diagnostics, visible files)
- A Tool Registry

Output ONLY a JSON object matching this schema:
{
  "intent": "human readable explanation",
  "confidence": 0.0 - 1.0,
  "ambiguities": [],
  "steps": [ 
    { "tool": "toolName", "args": {}, "dependsOn": [] } 
  ]
}
```

Notice the `steps` array. The LLM does not output a single tool call; it outputs a **Plan**. If the user says, *"Run the tests for this,"* the LLM outputs a two-step sequence:
1. `FindTestFile` (args: active function name)
2. `ExecuteTest` (args: output of step 1)

### 3. The Topological Executor: Deterministic Safety
One of the most dangerous trends in current AI engineering is allowing LLMs to execute code or DOM interactions directly in a `while(true)` loop. If the model hallucinates, it can delete files or click the wrong buttons before the user can intervene.

In USIR, the LLM **never executes anything**. It only generates the JSON `ExecutionPlan`.

That plan is handed to the `TopologicalExecutor.ts`.

```typescript
export interface ExecutionStep {
  tool: string; 
  args: Record<string, any>; 
  dependsOn: number[]; // Step indices this step waits for
  optional: boolean;
}
```
The executor treats the plan as a Directed Acyclic Graph (DAG). 
*   If Step 1 and Step 2 have empty `dependsOn` arrays, they run in parallel (e.g., fetching a file while simultaneously querying a database).
*   If Step 3 depends on `[1, 2]`, it waits for both to resolve.

This separation of planning and execution provides massive benefits:
1. **Safety & Auditability:** The UI can present the JSON plan to the user for confirmation *before* any destructive action (like deleting a file) occurs.
2. **Deterministic Fallbacks:** If a step fails, the executor catches it cleanly, aborts dependent steps, and informs the LLM exactly where the plan broke, rather than allowing the AI to blindly continue operating on corrupted state.
3. **Speed:** Independent steps run concurrently, drastically speeding up multi-tool operations.

### The Missing Piece: Ambiguity
We now have a system that remembers context, routes intent in a single pass, and executes plans safely. 

But what happens when the LLM looks at the Semantic Snapshot and realizes it doesn't know what the user wants? What if the user says, *"Go to the error handler,"* and there are four different error handling functions in the current file?

Current agents either guess (and usually guess wrong) or fail and ask the user to type out a clarification. Both ruin the magic of ambient computing.

We need a system that handles ambiguity as a first-class feature of the UX.

---
**Next up in Part 5:** *Collaborative Narrowing — The End of "AI Hallucination" in UX.* We will explore the `ambiguities` array in our JSON plan, build the Disambiguation Loop, and introduce a fundamentally new interaction paradigm that seamlessly blends voice commands with visual interfaces to resolve confusion instantly.