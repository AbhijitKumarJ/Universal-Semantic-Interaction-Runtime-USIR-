# Part 2: The Universal Intent Ontology — HTTP Verbs for Human Minds

*Decoding the Post-GUI Runtime — Part 2 of 14*

---

There is a specific moment in the USIR ideation conversation where the entire project changes register. Up until that point, the discussion is about *presentation*: how do you send a UI template to a device, how do you make an XML waypoint work across modalities, how do you adapt a web app to voice. Then, post-review, a single sentence lands and everything shifts:

> *"Moving from UI abstraction to semantic state abstraction is the true prerequisite for Ambient Computing. Defining a Universal Interaction Language of ~50 intents with an interaction memory layer is the exact software stack required to kill the traditional GUI."*

Fifty intents. Not fifty widget types, not fifty API endpoints, not fifty screen templates. Fifty *cognitive verbs*. The claim is that the full range of what a human being does with software can be decomposed into roughly fifty fundamental actions, organized into layers from reflexive (cancel, undo) to social (share, annotate, broadcast).

This claim is either a profound insight about the nature of human–computer interaction, a convenient fiction for making the architecture tractable, or both. This post examines it seriously, from the TypeScript implementation in `packages/protocol/src/intents/index.ts` through to the design decisions the code encodes — and what it quietly leaves unsaid.

---

## The Shape of the Claim

Before looking at code, it's worth being precise about what the ontology is actually asserting.

It is not claiming that fifty intents covers every user action. It is claiming that fifty intents covers every *intent class* — that any user action, however surface-specific it appears, is either a direct instance of one of these verbs or a composition of several.

The distinction matters. When you "format this function with Prettier," you are not doing a special Prettier-specific action. You are doing `intent.execution.run` with `target = current function`, `command = prettier --write`. The Prettier-specific details are arguments. The intent is the verb.

When you "find all places this is broken," you are doing `intent.information.search` with a semantic query. When you "give this variable a better name," you are doing `intent.manipulation.edit` with `operation = rename`. The vocabulary of any specific application is just parameterization on top of universal verbs.

This is exactly the thesis of HTTP methods applied to interaction. `GET /users` and `GET /orders` are very different operations semantically, but they share the same verb class: read-without-side-effects. USIR's ontology does the same thing for human intent.

The question is whether the decomposition holds cleanly — or whether, somewhere in the space of real human–computer interactions, there are actions that genuinely don't fit into this taxonomy.

---

## The Architecture of `@usir/protocol/src/intents/index.ts`

The file opens with a comment that is itself a specification:

```typescript
/**
 * Universal Intent Ontology
 *
 * The 8-layer hierarchy of cognitive verbs that USIR exposes. This is
 * the "HTTP of interaction" — every app, agent, and adapter must speak it.
 *
 * L0  Meta          — about the conversation/system itself
 * L0.5 Provenance   — about the history/why of mutations
 * L1  Navigation    — finding/positioning in the semantic graph
 * L2  Attention     — focus/selection within a surface
 * L3  Information   — read/understand/compute
 * L4  Manipulation  — modify existing entities
 * L5  Creation      — make new entities
 * L6  Execution     — trigger external effects
 * L7  Delegation    — hand off to agents
 * L8  Collaboration — share with other runtimes
 */
```

Nine layers (L0 through L8, with L0.5 inserted). But notice what is absent from this list: anything about the *surface* of interaction. There is no "click," no "scroll," no "type." There is no "swipe," no "speak," no "point." Those are modalities — ways of delivering an intent. The ontology is strictly about the *intent*, not the *mechanism*.

This is the hardest discipline to maintain in practice. Every time a new input modality appears (XR hand tracking, watch crown rotation, eye gaze), the temptation is to add new intent types to handle it. USIR resists this by routing all new modalities through the `ExpectedInputs` structure in the `InteractionWaypoint`, leaving the intent ontology itself modality-agnostic.

### The Base Type

The foundation of every intent is `BaseIntent`:

```typescript
export interface BaseIntent {
  type: string;
  intentId: string;
  timestamp: number;
  actor: IntentActor;
  rawInstruction?: string;
  confidence: number;
  ambiguities?: Ambiguity[];
}

export interface IntentActor {
  type: 'user' | 'agent' | 'system';
  id: string;
  agentConfidence?: number;
}

export interface Ambiguity {
  field: string;         // JSON-path-like: "steps[0].args.target"
  candidates: string[];  // candidate entity IDs
  question: string;      // natural language question for the user
  options?: string[];    // suggested response options
}
```

Four design choices here are each carrying significant weight:

**`type: string` rather than an enum.** The `type` field is a string in the form `intent.layer.verb` — for example `intent.manipulation.edit` or `intent.collaboration.share`. Using a string instead of a numeric enum or a symbol makes the type human-readable in logs, serializable without a schema lookup, and forward-compatible (new intent types can be added without a schema version bump). The downside is that typos are not caught at compile time unless you're using the specific intent interfaces (which narrow `type` to a literal string).

**`confidence: number` on every intent.** Confidence is not an afterthought; it's a core field. The LLM Router populates this when it parses a user utterance. The Topological Executor uses it to decide whether to proceed, checkpoint, or surface a disambiguation waypoint. A confidence below 0.7 is a hard threshold that triggers the disambiguation UI in the router's system prompt.

**`ambiguities?: Ambiguity[]`.** Rather than throwing when it can't resolve a reference, the LLM Router adds `Ambiguity` entries and lowers confidence. The executor sees the ambiguities and routes to the waypoint system. The intent still gets created — it just carries its unresolved parts explicitly, as `UNRESOLVED:fieldName` sentinel strings in the step arguments.

**`rawInstruction?: string`.** Every intent optionally carries the exact thing the user said. This is critical for provenance: when you look at a mutation in the provenance log, you can see not just what happened but what the user actually said that caused it. "rename user to account" becomes an edit intent, and the provenance node records both the formal intent and the casual instruction.

---

## Walking the Layers

### L0: Meta — The Conversational Reflexes

```typescript
export interface MetaIntent extends BaseIntent {
  type: 'intent.meta.cancel' 
      | 'intent.meta.repeat' 
      | 'intent.meta.help' 
      | 'intent.meta.undo' 
      | 'intent.meta.redo';
}
```

L0 is interesting for what it collapses. `undo` and `redo` are here, but not as first-class operations with payload — they're reflexes that the runtime handles by walking the provenance store backward or forward. This design choice has an important consequence: undo is not adapter-specific. A VS Code undo walks the provenance store and inverts the last mutation. A browser undo does the same. The adapter doesn't need to implement undo logic; it just needs to support the inverse of each tool call.

`cancel` covers "stop what you're doing" across all in-flight operations — both synchronous executor steps and background agent tasks. `repeat` replays the last execution plan. Neither of these would make sense in a traditional API context where each call is stateless. They only work because USIR maintains session memory and an execution history.

### L1–L2: Navigation and Attention — Positioning the User's Focus

```typescript
export interface LocateIntent extends BaseIntent {
  type: 'intent.navigation.locate';
  target: CognitiveReference;
  filters?: {
    role?: string;
    attributes?: Record<string, unknown>;
    spatial?: { region: string; radius?: number };
  };
}

export interface FocusIntent extends BaseIntent {
  type: 'intent.attention.focus';
  target: CognitiveReference;
  region?: string;
}
```

The separation between L1 (Navigation) and L2 (Attention) is subtle and important. Navigation is about *finding* something in the graph. Attention is about *focusing on* it once found. `locate` returns a set of candidates; `focus` makes one of them the active entity in the Hot tier.

This matches how human cognition actually works: you *look for* something (scanning, searching, browsing), and then you *direct your attention* to it (focus, select, highlight). These are distinct cognitive operations, and conflating them produces the classic problem of voice systems that jump to the wrong thing. USIR separates the search from the commitment.

`HighlightIntent` is noteworthy for its `style` and `durationMs` fields — it's the formal encoding of the "hand-wave animation" from the ideation conversation, the visual confirmation step in the disambiguation handshake.

### L3: Information — The Read-Only Layer

```typescript
export interface ExplainIntent extends BaseIntent {
  type: 'intent.information.explain';
  target: CognitiveReference;
  depth?: 'brief' | 'normal' | 'detailed';
}

export interface CompareIntent extends BaseIntent {
  type: 'intent.information.compare';
  targets: Array<CognitiveReference>;
  dimension?: string;
}
```

L3 contains only read operations. No mutation, no side effect. This matters for the trust classification system: the `LLMRouter.classifyTrustTier()` method returns Tier 1 (auto-execute, no confirmation needed) for any `intent.information.*` intent. The agent can explain, summarize, compare, and search freely without asking permission.

`CompareIntent` takes a *plural* `targets` array. This is one of the few intents that operates on multiple entities simultaneously. The dimension field is deliberately open-ended — "compare the auth module with the payments module on *dependency count*" vs. "compare them on *complexity*" vs. "compare them on *test coverage*" all map to the same intent type with different `dimension` values. The adapter decides what to do with that dimension string.

### L4–L5: Manipulation and Creation — Where Mutations Begin

```typescript
export interface EditIntent extends BaseIntent {
  type: 'intent.manipulation.edit';
  target: CognitiveReference;
  operation: 'rename' | 'replace' | 'insert' | 'delete' | 'transform';
  value?: string | Record<string, unknown>;
}

export interface CreateIntent extends BaseIntent {
  type: 'intent.manipulation.create';
  entityRole: string;
  parent: CognitiveReference;
  name: string;
  template?: string;
  content?: string;
}
```

There is a quiet inconsistency worth examining: `CreateIntent` is typed as `intent.manipulation.create` despite ostensibly being the L5 Creation layer. The `getIntentLayer` function returns `4` for it:

```typescript
export function getIntentLayer(intent: BaseIntent): IntentLayer {
  if (intent.type.startsWith('intent.manipulation.')) return 4;
  if (intent.type.startsWith('intent.creation.')) return 5;
  // ...
}
```

And in the tests:
```typescript
it('returns 4 for creation intents (under manipulation layer)', () => {
  expect(getIntentLayer(makeIntent('intent.manipulation.create'))).toBe(4);
});
```

This means `CreateIntent` is effectively in L4 (manipulation) even though the spec describes L5 as "Creation." There is no `intent.creation.*` string used in the actual type union, and nothing maps to layer 5 in the `getIntentLayer` function. Layer 5 is specified but currently unoccupied.

This is either a schema migration artifact (L5 was planned but merged into L4 for simplicity), or a genuine design decision that creation is just a special case of manipulation — making something from nothing is still a manipulation of the semantic graph. The spec's layer numbering is slightly inconsistent with the implementation, and the tests acknowledge this with the parenthetical "under manipulation layer."

### L6: Execution — Crossing the Side-Effect Boundary

```typescript
export interface ExecuteIntent extends BaseIntent {
  type: 'intent.execution.run';
  target: CognitiveReference;
  command?: string;
  args?: string[];
}
```

L6 is the layer where things happen in the external world. Running a test suite. Executing a build. Triggering a deployment. The trust classifier returns Tier 3 for execution intents — always requires approval from the user before the executor will dispatch them. There is no confidence threshold that bypasses this.

The `command` and `args` fields are intentionally loose (strings, not typed). This is because execution targets are adapter-specific: in the VS Code adapter, `command` might be a VS Code command ID. In the OS adapter, it might be a shell command. The semantic intent is "run this thing" — the adapter supplies the implementation.

### L7: Delegation — The Agentic Frontier

```typescript
export interface DelegateIntent extends BaseIntent {
  type: 'intent.delegation.delegate';
  target: SemanticEntity | CognitiveReference;
  objective: string;
  constraints?: string[];
  confidenceThreshold?: number;
  sandboxEntityIds?: string[];
  maxExecutionMs?: number;
}

export interface CheckpointIntent extends BaseIntent {
  type: 'intent.delegation.checkpoint';
  stepIndex: number;
  decision: 'approve' | 'reject' | 'discuss';
  rationale?: string;
}
```

`DelegateIntent` is the most structurally complex intent in the ontology. The `sandboxEntityIds` field is particularly significant: it's how the user explicitly bounds what the agent is allowed to touch. "Refactor the auth module" becomes `sandboxEntityIds: ['file:///src/auth.ts', 'file:///src/auth.test.ts']` — the agent may not touch anything outside those files, regardless of how confident it is about the improvement.

`CheckpointIntent` is the human-facing side of delegation — the way the user approves, rejects, or continues discussion about a step the agent proposed. The `rationale` field is bidirectional: the agent sets it when explaining why it wants to do something, and the human can set it when explaining why they're rejecting. Both end up in the provenance log.

Notice that `DelegateIntent.target` can be either a `SemanticEntity` *or* a `CognitiveReference` — one of only two intents (along with `PlanIntent`) with this dual typing. This is deliberate: delegation can target a specific, already-resolved entity or a fuzzy description ("the thing I was building yesterday"). The memory system resolves the reference before passing it to the agent.

### L8: Collaboration — The Social Layer

```typescript
export interface ShareIntent extends BaseIntent {
  type: 'intent.collaboration.share';
  target: SemanticEntity | SemanticEntity[];
  collaboratorId: string;
  permissions: ('read' | 'comment' | 'edit' | 'delegate')[];
  expiresAt?: number;
}

export interface AnnotateIntent extends BaseIntent {
  type: 'intent.collaboration.annotate';
  target: SemanticEntity;
  annotation: string;
  anchor?: { spatial?: unknown; temporal?: unknown };
}

export interface BroadcastIntent extends BaseIntent {
  type: 'intent.collaboration.broadcast';
  annotationId: string;
  recipients: string[];
  modality?: 'voice' | 'text' | 'spatial';
}
```

L8 is where the first review's critique shows up directly in the code. The original ideation had `DiscussIntent` doing too much — encoding a message, a spatial reference, and a modality-translation request simultaneously. The implemented version separates concerns cleanly: `AnnotateIntent` attaches meaning to an entity, `BroadcastIntent` sends an annotation to recipients. The receiving runtime handles modality translation. `DiscussIntent` still exists but is now strictly a message about an entity, not a multi-purpose broadcast vehicle.

`ShareIntent.permissions` uses a graduated `('read' | 'comment' | 'edit' | 'delegate')[]` model. The `delegate` permission is notable: it allows the collaborator to further delegate the entity to their own agents, creating a transitive delegation chain. The `TrustMigration` module in the federation layer is responsible for verifying that permission chains are valid before an agent in runtime B acts on behalf of a user in runtime A.

---

## The Three Runtime Helpers: Where Policy Lives in Code

The most policy-laden code in `intents/index.ts` is not the intent definitions themselves but the three functions at the bottom:

```typescript
export function getIntentLayer(intent: BaseIntent): IntentLayer {
  if (intent.type.startsWith('intent.meta.')) return 0;
  if (intent.type.startsWith('intent.navigation.')) return 1;
  if (intent.type.startsWith('intent.attention.')) return 2;
  if (intent.type.startsWith('intent.information.')) return 3;
  if (intent.type.startsWith('intent.manipulation.')) return 4;
  if (intent.type.startsWith('intent.creation.')) return 5;
  if (intent.type.startsWith('intent.execution.')) return 6;
  if (intent.type.startsWith('intent.delegation.')) return 7;
  if (intent.type.startsWith('intent.collaboration.')) return 8;
  return 0;
}

export function isMutatingIntent(intent: BaseIntent): boolean {
  return getIntentLayer(intent) >= 4;
}

export function isReversibleIntent(intent: BaseIntent): boolean {
  if (intent.type === 'intent.manipulation.delete') return false;
  if (intent.type === 'intent.execution.run') return false;
  if (intent.type === 'intent.collaboration.share') return false;
  return true;
}
```

`getIntentLayer` dispatches by string prefix. This is fast and readable but has a subtle fragility: if a future intent type is named `intent.manipulation2.bulk_edit`, it would return layer 4 (because `'intent.manipulation2.'` starts with `'intent.manipulation'`). In practice this would never happen because the naming convention is enforced, but it's a parser that could be more defensive.

`isMutatingIntent` is the boundary between read and write. The rule is simple: L0–L3 don't mutate state; L4 and above do. This drives the provenance system — every call to `isMutatingIntent(intent) === true` must result in a `ProvenanceNode` being written before the executor dispatches the tool call.

`isReversibleIntent` is where the three "always requires human approval" intents are named explicitly: delete, run, and share. The logic is worth thinking about carefully. Why is `delete` irreversible but `edit` reversible? Because `edit` is backed by a `contentHashBefore` in the provenance store — you can reconstruct the previous state. `delete` removes the entity entirely; even if you can reconstruct its content, the fact that it existed at a certain ID at a certain time is gone. Why is `share` irreversible? Because once you've sent semantic state to a peer runtime, you cannot un-send it. The recipient has seen the data.

Why is `intent.execution.run` irreversible? This is the most philosophically interesting case. Running a test suite is a side effect in the real world. It may send network requests, write to disk, hit external APIs, trigger billing. The content hash of the VS Code terminal state before and after is not a meaningful "undo" for those external effects. So the executor marks execution intents as irreversible and always surfaces a checkpoint before dispatching.

---

## `CognitiveReference`: The Secret Weapon

Scattered through almost every intent interface is a field typed as `CognitiveReference`. It appears so often it's easy to skim past, but it is the single design decision that most distinguishes USIR from every other tool-calling framework.

```typescript
export type CognitiveReference =
  | TemporalReference       // "the file I opened yesterday"
  | ConversationalReference // "the previous one"
  | SpatialReference        // "the thing below it"
  | SemanticReference;      // "the design discussion we had earlier"

export interface SpatialReference extends BaseReference {
  kind: 'spatial';
  anchorEntityId?: string;
  direction?: 'below' | 'above' | 'left' | 'right' | 'next_to' | 'inside' | 'overlapping';
  sizeRelation?: 'wider' | 'taller' | 'smaller' | 'larger' | 'bigger';
  visualAttribute?: string;
}

export interface SemanticReference extends BaseReference {
  kind: 'semantic';
  description: string;
  topic?: string;
}
```

Compare this to how OpenAI function calling works. When you define a tool with parameters, those parameters are concrete: `file_path: string`, `line_number: number`. The caller must provide exact values. If the user says "that file I had open earlier," the entire resolution burden falls on the calling code to somehow translate "that file" into a concrete path before it can call the function.

USIR inverts this. `CognitiveReference` is a first-class type in the protocol. The LLM Router doesn't resolve references before creating an intent — it *encodes* the reference kind and lets the `InteractionMemory` system resolve it against the current semantic graph. A `LocateIntent` with `target: { kind: 'temporal', relativeTime: 'yesterday', eventType: 'opened' }` carries the fuzzy reference explicitly. The runtime resolves it. The LLM Router is responsible for *classifying* the reference kind; the memory system is responsible for *resolving* it.

This separation means the LLM Router prompt doesn't need to include the full conversation history or the full entity graph to resolve references. It only needs to emit the right reference kind and let the resolution engine handle the rest. This keeps prompts small and fast while still allowing natural, pronoun-heavy human speech.

The `BaseReference` interface includes a `resolvedEntityId?: string` field. Once the memory system resolves a reference, it stamps the concrete entity ID back onto the reference object. This means the provenance log can record both the fuzzy reference as the user expressed it *and* the concrete entity that was actually acted upon. If the memory system resolved "that file" to `main.ts` when the user meant `auth.ts`, the mismatch is visible in the provenance chain.

---

## The `UniversalIntent` Union and the Type Guard Architecture

The full union type at the bottom of the file tells you exactly how many distinct intent interfaces exist:

```typescript
export type UniversalIntent =
  | MetaIntent
  | LocateIntent | OpenIntent | CloseIntent | NavigateIntent     // L1
  | FocusIntent | SelectIntent | HighlightIntent                  // L2
  | ExplainIntent | SummarizeIntent | CompareIntent | SearchIntent // L3
  | EditIntent | MoveIntent | DeleteIntent | CreateIntent          // L4+L5
  | ExecuteIntent | ScheduleIntent                                 // L6
  | PlanIntent | DelegateIntent | CheckpointIntent                 // L7
  | ShareIntent | DiscussIntent | AnnotateIntent | BroadcastIntent; // L8
```

Twenty-five distinct interfaces, not fifty. The "~50 cognitive verbs" figure from the ideation conversation likely counted the individual verb strings within `MetaIntent`'s type literal (`cancel`, `repeat`, `help`, `undo`, `redo` = 5 from one interface) plus planned but not-yet-implemented verbs. The actual implemented count is 25 interfaces mapping to roughly 30 distinct `type` strings.

This is the first sign that the ontology is still growing. The `docs/ontology/README.md` lists several known gap areas: "spatial/XR verbs — anchor, pin, resize, rotate," "IoT verbs — dim, lock, arm, setThermostat," "health/wellness — log, measure, remind," "game verbs — equip, cast, trade." These are all real domains that will need intent additions if USIR is to be genuinely universal.

The type guards — `getIntentLayer`, `isMutatingIntent`, `isReversibleIntent` — together form the access control policy of the entire runtime. They are three functions, sixty lines of code, and they determine:
- Which intents are audited (all mutating ones)
- Which intents require human confirmation (all irreversible ones)
- Which intents can be executed by agents autonomously (reversible L4 and below the confidence threshold)

Sixty lines that span the gap between "intent classification system" and "safety model."

---

## The `IntentEnvelope`: Routing Context

One more type deserves attention because it shows up in the execution pipeline but is easy to miss:

```typescript
export interface IntentEnvelope<T extends BaseIntent = BaseIntent> {
  intent: T;
  target?: SemanticEntity | CognitiveReference;
  args?: Record<string, unknown>;
  dependsOn?: string[];
  optional?: boolean;
}
```

`IntentEnvelope` is the wrapper that the Topological Executor operates on. It adds `dependsOn` — the DAG edge declaration — and `optional` — whether a failing step should abort the entire plan or be skipped. The executor builds a dependency graph from `dependsOn` arrays across all envelopes in an execution plan, then runs independent envelopes in parallel and waits for dependencies before dispatching dependent ones.

The `target` on the envelope is redundant with the intent's own `target` field for most intents, but provides a uniform place for the executor to look without needing to know which specific intent interface it's handling. The generic parameter `<T extends BaseIntent>` means the envelope is fully typed when the specific intent type is known, but the executor can operate on `IntentEnvelope<BaseIntent>` when it just needs to dispatch without caring about the specific variant.

---

## The Ontology as Protocol: What HTTP Teaches Us

The README comparison to HTTP verbs is not just marketing. HTTP's success depended on a constraint that felt limiting when the web was young: the verb set is *closed*. There is no `CALCULATE` verb, no `VALIDATE` verb, no `REPORT` verb. Everything is `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, or one of the handful of minor verbs. When your use case doesn't fit — and many don't fit cleanly — you work within the constraint and put the semantics in the URL, the body, or a custom header.

This constraint is what made REST interoperable. If every API could define its own verbs, there would be no generic HTTP clients, no CDNs, no proxies, no caching infrastructure. The closed verb set is what created the ecosystem.

USIR is betting on the same dynamic. If `intent.manipulation.edit` covers renaming, replacing, inserting, deleting, and transforming — then any generic USIR middleware (an audit logger, a rate limiter, a permission gate, a replay buffer) can handle all edits without knowing anything about the application being edited. The intent type is the routing key.

The risk is also the same as HTTP faced: the closed set creates pressure to abuse existing verbs. In HTTP, `POST` became the catch-all for operations that didn't fit `GET` or `PUT`. In USIR, there will be pressure to stuff novel interactions into `intent.manipulation.edit` with creative `operation` values, or into `intent.execution.run` because "it's sort of running something." The RFC process in `docs/ontology/README.md` is the circuit breaker — a formal mechanism for *adding* verbs rather than contorting existing ones.

Whether the RFC process will work depends on the ecosystem forming around it. A protocol ontology that no one is building adapters for can change its verbs at will with no cost. A protocol ontology that ten thousand adapters depend on cannot change anything without breaking them all. The discipline required to maintain a closed, stable vocabulary increases proportionally with adoption. USIR is betting it can maintain that discipline before the pressure becomes acute.

---

## What the Ontology Gets Right, What It Leaves Open

**What it gets right:**

The cognitive layering is sound. The progression from L0 (reflexes) through L3 (reading) through L6 (execution) through L8 (collaboration) maps onto a real ordering of cognitive cost and irreversibility. A user can be interrupted at L0 without consequence; interrupting at L6 has side effects. The layer number is also the trust number. This is elegant.

The `CognitiveReference` system is the most underrated design decision in the entire protocol package. No other tool-calling framework treats fuzzy human references as a first-class type. They all require resolution before the function can be called. USIR defers resolution into the runtime, which is the right abstraction boundary.

The `isReversibleIntent` function draws the right lines. Delete, run, and share are correctly identified as the three operations where "undo" is either impossible or meaningless.

**What it leaves open:**

The semantic resolver in `CognitiveReference` has no embedding support. `SemanticReference.description = "the design discussion we had earlier"` is a free-text string. The resolution engine currently does fuzzy string matching against entity `displayName` fields. That breaks immediately on synonyms ("auth module" vs. "authentication system"), abbreviations, and cross-language queries. The field is the right hook for embeddings-based resolution — it just isn't wired up yet.

Layer 5 (Creation) is formally specified but unoccupied in the current implementation. `CreateIntent` lives at `intent.manipulation.create` and returns layer 4. This is a minor schema inconsistency that will need to be resolved before the ontology reaches 1.0.

The `IntentLayer` type is `0 | 0.5 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`. Using a float (`0.5`) as a discriminated union value is unusual in TypeScript and will cause friction for anyone doing arithmetic on layer numbers or using them as array indices. A string-typed layer identifier (`'meta' | 'provenance' | 'navigation' | ...`) would be more idiomatic — but that ship may have sailed, since the numeric values are documented throughout the spec and the blog series.

---

## From Verbs to Sentences: The LLM Router as Compiler

The intent ontology only becomes useful when you can reliably map a human utterance to one of its types. That mapping is the `LLMRouter`'s job. The system prompt is a direct translation of the ontology's design principles into LLM instructions:

```
CRITICAL RULES:
- You NEVER execute. You only PLAN.
- You NEVER guess when ambiguous. Use the "ambiguities" field.
- You MUST use only tools from the provided tool registry.
- If confidence is below 0.7, you MUST declare ambiguities.
- Prefer parallel execution when steps have no dependencies.
```

The "never guess" rule is the ontology's closed-set constraint expressed as a prompt instruction. When the user says something that doesn't clearly map to a known intent — "do the thing we talked about yesterday" — the router doesn't pick the closest match. It emits a low-confidence plan with ambiguities declared, triggering the disambiguation waypoint. This is architecturally correct: the router is a compiler, not a mind-reader.

The temperature-zero configuration (`temperature: this.deps.config.temperature ?? 0`) is the implementation of "deterministic plans." Two identical inputs should produce identical execution plans. At non-zero temperature, the same user utterance could produce different plans on different calls, making the system non-reproducible and the provenance log unreliable.

The `response_format: { type: 'json_object' }` forces structured output. The router doesn't parse freeform LLM text — it always receives a JSON object it can validate against the `ExecutionPlan` schema. When the validation fails (missing `steps` array, missing `confidence`, missing `detectedIntentType`), the router throws rather than silently accepting a malformed plan.

---

## What Comes Next

The intent ontology is the vocabulary. But a vocabulary without memory is a dictionary, not a conversation. The next post goes deep on `CognitiveReference` resolution — the `InteractionMemory` system that allows the runtime to resolve "that file," "the previous one," and "the function causing this timeout" against a live semantic graph. This is where USIR makes its strongest argument against every voice assistant that came before it.

---

*The implementation referenced throughout this post is in `packages/protocol/src/intents/index.ts`, `packages/protocol/src/memory/index.ts`, and `packages/runtime/src/router/`. All code is from the pre-alpha USIR repository.*

*← [Part 1: The Problem USIR Is Actually Solving](./usir-part-01-the-problem.md) | [Part 3: Semantic Entities — When Everything Is a Node →]()*
