# Beyond the GUI, Part 2: The Universal Protocol — Mapping Meaning, Not Screens

In [Part 1](./01-the-gui-trap.md), we established that the Graphical User Interface is a trap for AI. By forcing agents to navigate visual hierarchies (pixels and DOM trees), we guarantee brittleness. To achieve true Ambient Computing, we must bypass the presentation layer entirely.

But if we bypass the GUI, what replaces it?

Early in the design of the **Universal Semantic Interaction Runtime (USIR)**, we considered defining a universal XML template system—a markup language for multi-modal rendering. But we quickly realized that was just reinventing HTML.

XML and DOMs are hierarchies (trees). But **human tasks are relationships (graphs).**

When a developer says, *"Run the test for the function I was editing before lunch,"* there is no single UI element on the screen that represents that command. The intent spans across time, file systems, and execution states.

To solve this, we need a protocol that maps *meaning*. In this post, we will dive into `@usir/protocol`, the foundational package of our monorepo, and explore the TypeScript schemas that replace the 40-year-old paradigm of windows, icons, and menus.

## 1. The Nouns: Semantic Entities

In a traditional UI framework, the atomic unit of the world is a `Widget` or a `Node`. In USIR, the atomic unit is a `SemanticEntity`.

A `SemanticEntity` strips away all visual presentation. It doesn't care if it's rendered as a button on a screen, a 3D hologram in XR, or spoken aloud through earbuds. It only cares about its semantic role and its relationship to other entities.

Here is the core interface from `packages/protocol/src/entities/index.ts`:

```typescript
export type EntityRole = 
  | 'source_file' 
  | 'function' 
  | 'class' 
  | 'variable' 
  | 'test' 
  | 'error' 
  | 'terminal'
  | 'ui_region'
  | 'user' 
  | 'agent'
  | 'document' 
  | 'task'
  | 'physical_device';   // for IoT

export interface SemanticEntity {
  /** Universal Resource Name — e.g. "file:///src/main.ts#L12" */
  id: string;
  /** What kind of thing this is, semantically */
  role: EntityRole;
  /** Human-readable name */
  displayName: string;
  /** Free-form semantic attributes (color, size, type signature) */
  attributes: Record<string, unknown>;
  /** Graph edges — relations to other entities */
  relations: EntityRelation[];
  /** Spatial position (2D screen or 3D volume) */
  spatial?: SpatialBounds;
  /** Audio fingerprint for voice-first clients */
  audioFingerprint?: {
    phoneticName: string;  // "Alpha", "Bravo", "Charlie"
    spokenDescription: string;
  };
  /** Last update timestamp */
  updatedAt: number;
  source: string;  // "vscode", "browser", "os"
}
```

The key insight is `relations`. A function `authenticateUser` *calls* `validateToken`, *is defined in* `auth.ts`, *has a test* `auth.test.ts`. These edges form a graph, not a tree. The runtime can traverse this graph in any direction to find context, dependencies, or related entities.

## 2. The Verbs: The Universal Intent Ontology

If entities are the nouns, intents are the verbs. USIR defines a closed set of **~50 cognitive verbs** that cover 90% of all software interactions. We call this the **Universal Intent Ontology**.

It is organized into 8 layers, from low-level navigation to high-level collaboration:

| Layer | Domain | Example Intents |
|---|---|---|
| L1 | Navigation | `locate`, `open`, `close`, `navigate` |
| L2 | Attention | `focus`, `select`, `highlight` |
| L3 | Information | `explain`, `summarize`, `compare`, `search` |
| L4 | Manipulation | `edit`, `rename`, `move`, `delete` |
| L5 | Creation | `create`, `scaffold` |
| L6 | Execution | `run`, `schedule` |
| L7 | Delegation | `plan`, `delegate`, `checkpoint` |
| L8 | Collaboration | `share`, `discuss`, `annotate`, `broadcast` |

The most critical design decision: **the ontology is closed and small**. We are not building an open vocabulary that grows infinitely. We are building a *finite set of cognitive primitives* that an LLM can reliably map user utterances to.

Here is the type union for all intents:

```typescript
export type UniversalIntent =
  | LocateIntent    // L1
  | OpenIntent      // L1
  | FocusIntent     // L2
  | SelectIntent    // L2
  | ExplainIntent   // L3
  | CompareIntent   // L3
  | EditIntent      // L4
  | MoveIntent      // L4
  | CreateIntent    // L5
  | ExecuteIntent   // L6
  | DelegateIntent  // L7
  | ShareIntent;    // L8

export interface BaseIntent {
  type: string;
  intentId: string;
  timestamp: number;
  actor: { type: 'user' | 'agent' | 'system'; id: string };
  rawInstruction?: string;
  confidence: number;
  ambiguities?: Ambiguity[];
}
```

The `confidence` field is the runtime's way of saying *"I think this is what you meant, but I'm not sure."* The `ambiguities` field lets the LLM declare what it couldn't resolve, which the runtime uses to trigger a disambiguation Waypoint (covered in Part 5).

## 3. Cognitive References: Solving "It" and "That"

The most underrated contribution of USIR is the `CognitiveReference` system. Humans rarely speak in fully-qualified paths. We say:

- *"that file"*
- *"the previous one"*
- *"the thing below it"*
- *"the function we were discussing earlier"*

Current voice assistants fail because they lack persistent contextual grounding. They treat every utterance in isolation. USIR treats memory as infrastructure.

```typescript
export type CognitiveReference =
  | TemporalReference      // "the file I opened yesterday"
  | ConversationalReference // "the previous one"
  | SpatialReference       // "the thing below it"
  | SemanticReference;     // "the design discussion"
```

Every reference has a `confidence` field and a `resolvedEntityId` that the runtime fills in. The `InteractionMemory` module (in `@usir/runtime`) maintains a ring buffer of recently-touched entities and resolves references against the current semantic graph.

## 4. The Snapshot: What Adapters Emit

The contract between an adapter and the runtime is the `SemanticSnapshot`. It is what every app exposes to USIR.

The most important design decision: the snapshot is **tiered** into three latency budgets:

```typescript
export interface SemanticSnapshot {
  hot: HotSnapshot;     // 16ms — cursor, focus, selection
  warm: WarmSnapshot;   // 150ms — visible entities, recent changes
  cold?: ColdSnapshot;  // seconds — full graph with LSP metadata
  source: string;
  version: number;
}

export interface HotSnapshot {
  tier: 'hot';
  activeRegion: string;
  activeEntity: SemanticEntity;
  selections: SemanticEntity[];
  ephemeral: Array<{ entityId: string; kind: 'select' | 'edit' | 'open' | 'close' }>;
  latencyBudgetMs: 16;
}
```

The Hot Tier is the **invocation anchor**—the small slice of state that says "the user is doing X *right now*." It is small enough to compute synchronously and ship as the first thing in any LLM request. The Cold Tier is the full graph, computed asynchronously. The runtime can respond in <100ms from Hot + Warm alone, then enrich with Cold on the next iteration.

This tiered structure is the engineering insight that makes sub-second voice interaction feel natural. We will dive into it in detail in Part 3.

## 5. Waypoints: The Multi-Modal Output

The runtime's output is an `InteractionWaypoint`—a structured description of *what to present to the user* across all available modalities. The runtime doesn't render anything. The client (web, mobile, XR, earbuds) renders the waypoint using its native capabilities.

```typescript
export interface InteractionWaypoint {
  id: string;
  context: { state: string; objective: string };
  presentations: {
    display?: DisplayPresentation;   // HTML/wizard UI
    audio?: AudioPresentation;       // TTS
    spatial?: SpatialPresentation;   // XR floating panel
    haptic?: HapticPresentation;     // watch double-tap
  };
  expectedInputs: {
    voice?: VoiceInput;
    touch?: TouchInput;
    gesture?: GestureInput;
  };
  fallback: FallbackChain;  // SMS/email/voice call for capability-zero devices
}
```

The `FallbackChain` is the safety net. If a user is on a feature phone with no display and no voice, the runtime can still reach them via SMS. Every waypoint must specify a fallback chain (added in review iteration 1).

## What's Next

The protocol is the foundation. But protocols don't run themselves. In [Part 3](./03-the-adapter-layer.md), we will see how the VS Code adapter translates the messy reality of the Extension API into a clean, tiered SemanticSnapshot in under 16 milliseconds.

---

**Next:** [Part 3: The Adapter Layer — Taming Legacy State in <16ms](./03-the-adapter-layer.md)
