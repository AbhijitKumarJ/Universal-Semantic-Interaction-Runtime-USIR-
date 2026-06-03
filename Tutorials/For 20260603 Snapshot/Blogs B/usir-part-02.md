# The Architecture of Intent, Part 2: The "HTTP of Interaction" (Universal Intent Ontology)

*Engineering the Post-GUI Era — Part 2 of 14*

---

If you build an AI agent today, the standard architectural pattern is "tool calling." You use something like OpenAI's function calling or the Model Context Protocol (MCP) to hand the LLM a JSON schema of available tools: `openFile`, `searchJira`, `clickButton`, `scrollWindow`. 

This approach works for narrow, vertical tasks. But as an operating system architecture, infinite, free-form tool-calling is a deterministic nightmare. 

If every application defines its own bespoke verbs, there is no shared semantic substrate. The AI has to relearn the conceptual model of every new app it encounters. Imagine if, instead of using standard HTTP methods (`GET`, `POST`, `PUT`, `DELETE`), every website on the internet defined its own custom transport verbs. The web would have collapsed under its own complexity.

In the Universal Semantic Interaction Runtime (USIR), applications do not get to define their own verbs. The runtime forces the entire universe of human-computer interaction into a rigid, closed ontology of roughly 50 cognitive verbs. 

This is the **Universal Intent Ontology (UIO)**. It is the "HTTP of interaction."

### Deconstructing the Stack

Defined in `docs/ontology/universal-intent-ontology-v1.md`, the ontology is organized into a strict 8-layer hierarchy. This layering isn't just for documentation; it dictates the security and execution models of the runtime. Cognitive complexity and destructive power increase as you move up the stack:

*   **L0 Meta & L0.5 Provenance:** System controls (`cancel`, `undo`) and causal audits (`explainMutation`).
*   **L1 Navigation & L2 Attention:** Read-only spatial and conceptual movement (`locate`, `open`, `focus`, `highlight`). 
*   **L3 Information:** Read-only data synthesis (`explain`, `compare`, `search`).
*   **L4 Manipulation & L5 Creation:** State mutations (`edit`, `move`, `delete`, `create`). 
*   **L6 Execution:** Side-effect triggers (`run`, `schedule`).
*   **L7 Delegation:** Asynchronous agent hand-offs (`plan`, `delegate`, `checkpoint`).
*   **L8 Collaboration:** Multi-runtime federation (`share`, `discuss`, `broadcast`).

Every action, whether triggered by a voice command in a car, a mouse click in a browser, or an eye-gaze in an XR headset, is normalized into one of these intents.

### The Anatomy of an Intent

To see how this works in practice, we have to look at the TypeScript implementation in `packages/protocol/src/intents/index.ts`. 

USIR relies heavily on string-typed discriminated unions. Here is the foundation of the protocol:

```typescript
export interface BaseIntent {
  type: string;
  intentId: string;
  /** When the intent was generated (epoch ms) */
  timestamp: number;
  /** The user/agent who originated the intent */
  actor: IntentActor;
  /** Original raw instruction (user's voice/text) */
  rawInstruction?: string;
  /** Confidence in the parsed intent, 0-1 */
  confidence: number;
  /** Ambiguities that the runtime could not auto-resolve */
  ambiguities?: Ambiguity[];
}

export interface EditIntent extends BaseIntent {
  type: 'intent.manipulation.edit';
  target: CognitiveReference;
  operation: 'rename' | 'replace' | 'insert' | 'delete' | 'transform';
  /** New value or transformation spec */
  value?: string | Record<string, unknown>;
}
```

This design choice—using string literals like `'intent.manipulation.edit'` instead of numeric enums—sacrifices a few bytes of network payload for massive developer ergonomics. 

Because `UniversalIntent` is exported as a massive discriminated union of all 50 verbs, the `TopologicalExecutor` (which we will cover in Part 7) can use `switch (intent.type)` to achieve exhaustive type checking at compile time. If a contributor adds an `intent.gaming.equip` verb but forgets to implement the execution handler, the TypeScript compiler fails the build.

Notice also the `target` field. It is not an `entityId` string. It is a `CognitiveReference`. Humans don't say, "Edit entity `dom://button#btn-4`." They say, "Rename *that* button." We will dedicate Part 6 to how Interaction Memory resolves these fuzzy references, but it's critical to note that the fuzzy reference is baked directly into the protocol's payload.

### Engineering Doubt: `confidence` and `ambiguities`

LLMs are notorious for being confident liars. If you give an LLM a tool called `editFile` and an ambiguous prompt like "Update the timeout," standard agent frameworks will force the LLM to guess which timeout to update just to satisfy the JSON schema.

USIR solves hallucination by making uncertainty a first-class citizen of the schema. 

Look back at `BaseIntent`. Every intent *must* carry a `confidence` float. If the LLM's confidence drops below a system threshold (usually 0.75), the LLM is explicitly prompted *not* to guess, but to populate the `ambiguities` array:

```typescript
export interface Ambiguity {
  /** JSON-path-like field reference: e.g. "steps[0].args.target" */
  field: string;
  candidates: string[];
  question: string;
  /** Suggested options the user can pick from */
  options?: string[];
}
```

If the runtime sees this array populated, the executor halts. It intercepts the intent *before* any state mutates and routes it to the Disambiguation UI. 

This is a profound architectural shift. Instead of treating ambiguity as an error state or a hallucination to be parsed out later, USIR structurally forces the LLM to admit what it doesn't know, packaging that doubt into a strongly-typed object that the UI can use to render a "Visual Handshake" (e.g., highlighting the three possible timeouts on screen and asking the user to pick one).

### The Critical Take: Is 50 Verbs a Premature Taxonomy?

USIR’s ontology is brilliant in its rigidity, but its rigidity is also its greatest risk. 

HTTP changed the world with just 5 primary methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). SQL dominates data with 4 (`SELECT`, `INSERT`, `UPDATE`, `DELETE`). GraphQL essentially uses 2 (`Query`, `Mutation`).

USIR proposes ~50. 

Is `intent.collaboration.annotate` truly a universal primitive of human-computer interaction, or is USIR leaking application-specific features (like Figma comments or Google Docs suggestions) into the base protocol? 

The repository includes a community proposal process in `docs/ontology/README.md`. As USIR expands to Spatial Computing (XR), IoT, and Gaming, the pressure to add `intent.spatial.anchor` or `intent.iot.arm` will be immense. 

If the maintainers are too strict, the ontology won't be expressive enough to run complex software, forcing developers to hack functionality into the `args` of generic execution intents. If they are too permissive, the ontology will bloat into thousands of verbs, recreating the exact fragmented nightmare of application-specific APIs that USIR was built to destroy.

The RFC process for stabilizing this ontology won't just be an open-source governance challenge; it will be an epistemological bloodbath.

### What's Next

Verbs are useless without nouns. If the Universal Intent Ontology dictates *how* we act, what exactly are we acting *upon*? 

In **Part 3**, we will look at the `SemanticEntity`. We will explore how USIR strips away pixels, CSS, and coordinates to represent the digital world as a pure graph, and we will dive into the `TreeWalker` algorithms the Browser Adapter uses to extract meaning from the chaos of modern Single Page Applications.

---
*Next:* **[Part 3: The Universal Node (Semantic Entities & Adapters)]**