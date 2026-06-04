# The Architecture of Intent, Part 6: Grounding the LLM (Interaction Memory)

*Engineering the Post-GUI Era — Part 6 of 14*

---

If you want to understand why voice assistants have failed to replace traditional computing, try issuing this command to Siri, Alexa, or a standard LLM agent:

*"Make that bigger."*

A human sitting next to you understands this instantly. They see you are pointing at a chart on your screen, and they understand that "bigger" means scaling its dimensions. 

An LLM fails catastrophically. It has no physical embodiment, no visual field, and no temporal context. To a stateless text-generation engine, "that" is a null pointer exception. 

Current AI wrappers attempt to fix this by blindly dumping the entire chat history and a massive DOM snapshot into the context window, hoping the attention mechanism of the transformer can deduce what "that" refers to. This is computationally expensive, slow, and highly prone to hallucination.

The Universal Semantic Interaction Runtime (USIR) takes a radically different approach. It removes reference resolution from the LLM entirely. It treats memory as deterministic infrastructure. 

In this post, we will tear open the `@usir/runtime` and `@usir/audio-pipeline` packages to see how USIR grounds natural language into hard semantic state.

### The Input Primitive: `FusedIntent`

Before the runtime can remember anything, it must accurately capture the user's present reality. A voice command does not happen in a vacuum. It happens in a physical and digital space.

In `packages/audio-pipeline/src/fused-intent.ts`, USIR defines its core input primitive. It does not just pass strings to the router; it passes a `FusedIntent`:

```typescript
export interface FusedIntent {
  /** Raw text instruction (from voice or typed) */
  linguisticInput: string;
  
  /** What the user is pointing at (mouse, gaze, touch) */
  pointingTarget: PointingTarget | null;
  
  /** Passive cognitive signals (typed cadence, gaze stability, etc.) */
  implicitSignals: ImplicitSignals;
  
  /** Which surfaces contributed (voice mic, gaze tracker, keyboard) */
  sources: Array<'voice' | 'text' | 'gaze' | 'mouse' | 'touch' | 'wearable'>;
  
  fusionConfidence: number;
}
```

This data structure is constructed synchronously at the exact millisecond the Voice Activity Detection (VAD) buffer triggers an "utterance end" event. 

By merging the transcribed text (linguistic) with the Hot Tier's active cursor or XR gaze vector (pointing) and recent physiological patterns (implicit), USIR solves the "Make that bigger" problem before the LLM is even invoked. If `pointingTarget.entityId` is populated, "that" is mathematically bound to a specific `SemanticEntity`.

### Teaching the Runtime to Forget

But humans don't just point. We refer to the past. *"Compare this with the previous one."*

To solve this, USIR implements `InteractionMemory`. 

If you look at `packages/runtime/src/memory/interaction-memory.ts`, you will notice a strict design constraint: the runtime maintains a ring buffer capped at 50 entities. 

```typescript
const HISTORY_LIMIT = 50;

public pushToHistory(entityId: string, options?: { rawInput?: string }): void {
  // Remove if it exists to bump it to the front (LRU style)
  this.history = this.history.filter((id) => id !== entityId);
  this.history.unshift(entityId);
  
  if (this.history.length > HISTORY_LIMIT) this.history.pop();
  
  this.lastDiscussed = entityId;
}
```

Why 50? Because boundless memory is a liability. By keeping the history strictly bounded, USIR ensures that temporal array lookups remain $O(1)$ or $O(N)$ with an infinitesimally small $N$. It guarantees that the "working memory" of the system mirrors human short-term memory, preventing the LLM router from pulling a stale entity from three hours ago when the user says "the last file."

### The Four Resolvers

When the LLM outputs a `CognitiveReference` payload (e.g., `{ kind: 'spatial', direction: 'below' }`), it hands it back to the runtime to resolve. `InteractionMemory` deploys one of four deterministic resolvers:

1.  **Temporal:** *"the file I opened yesterday"* (Filters the history by timestamp and event type).
2.  **Conversational:** *"the previous one"* (Grabs `this.history[1]`).
3.  **Spatial:** *"the panel on the right"*
4.  **Semantic:** *"the auth logic"*

The Spatial resolver is particularly elegant because it utilizes the 2D bounding boxes (or 3D XR volumes) provided by the Hot/Warm snapshot tiers to perform actual geometry calculations. 

Here is how USIR resolves *"the thing below that"* without the LLM seeing a single pixel:

```typescript
private isSpatialMatch(anchor: any, target: any, ref: SpatialReference): boolean {
  if (!ref.direction) return true;
  switch (ref.direction) {
    case 'below':
      // The target's top Y coordinate is below the anchor's bottom Y coordinate
      return target.y > anchor.y + anchor.height;
    case 'above':
      return target.y + target.height < anchor.y;
    case 'left':
      return target.x + target.width < anchor.x;
    case 'right':
      return target.x > anchor.x + anchor.width;
    case 'inside':
      return target.x >= anchor.x && target.y >= anchor.y && 
             target.x + target.width <= anchor.x + anchor.width && 
             target.y + target.height <= anchor.y + anchor.height;
  }
  return false;
}
```

The runtime iterates through the Warm tier entities, applies this geometric filter relative to the anchor, and resolves the target perfectly. 

### The Critical Take: The Vectorless Ceiling

The Spatial, Temporal, and Conversational resolvers in USIR are mathematically robust. They work. 

The Semantic resolver, however, exposes a glaring architectural weakness. 

Look at how the current MVP implements the resolution of a command like, *"Revert the auth logic"* in `interaction-memory.ts`:

```typescript
private resolveSemantic(ref: SemanticReference, candidates: SemanticEntity[]): string | null {
  const desc = ref.description.toLowerCase();
  const matches = candidates.filter((e) => 
    e.displayName.toLowerCase().includes(desc) || 
    e.role.toLowerCase().includes(desc)
  );
  return matches[0]?.id ?? null;
}
```

This is rudimentary string-matching. It relies on `String.includes()`. 

This is a massive UX cliff. If the user says, *"Open the login stuff,"* and the actual file is named `authentication.ts`, `includes()` fails. The reference resolves to `null`. The operation aborts. 

You cannot build a frictionless, intent-driven operating system based on `toLowerCase()` regex matching. Natural language is messy, heavily reliant on synonyms, slang, and contextual paraphrasing. 

To fulfill the promise of Semantic reference resolution, USIR desperately needs an embedded Vector/Embedding Engine. The runtime must calculate the cosine similarity between the user's fuzzy spoken reference and a continuous embedding of the `SemanticEntity`'s description and context. 

Without local embeddings (e.g., hooking into a local ONNX runtime or SQLite vector extension), the Semantic resolver will constantly hit a ceiling of brittleness, forcing users to memorize the exact `displayName` of their entities—ironically recreating the exact rigid command-line behavior USIR was built to destroy.

### What's Next

Once `InteractionMemory` has successfully resolved the pronouns and the runtime knows exactly *what* entities are in play, it is time to figure out *what to do* with them. 

In **Part 7**, we will examine the beating heart of USIR: the **LLM Router and Topological Executor**. We will explore why USIR strictly forbids the LLM from executing code, how it constructs JSON Directed Acyclic Graphs (DAGs), and how it handles execution failures using exponential backoff and circuit breakers.

---
*Next:* **[Part 7: Planners, Not Operators (Router & Executor)]**