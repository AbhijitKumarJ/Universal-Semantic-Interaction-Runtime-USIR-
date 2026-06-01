# Turn 44 — USIR

> **USIR responded:**

**Defining the Focus**

I'm currently dissecting the blog post request. It's about Part 2 of "The Universal Protocol," aiming at staff engineers, AI researchers, and UX architects. I'm focusing on contrasting screen hierarchies with something else – I haven't quite figured out what yet! I am focusing on what needs to be contrasted with the rigid heirarchy of screens.


**Developing the Core Concepts**

I've been solidifying the core concepts. I'm moving away from XML, instead favoring semantic state graphs. My draft includes the Universal Intent Ontology (v0.1) with roughly 50 verbs, alongside the `SemanticEntity` interface, and `CognitiveReference` for handling "that" and "it" references. I am also working on the `SemanticSnapshot` JSON payload.


**Refining the Structure**

Now I'm diving into the Universal Intent Ontology. I'm focusing on those cognitive verbs. I want to showcase the `IntentEnvelope` and base intent TS structures to really drive the idea home. The 'Semantic Snapshot' is now in view, with a tiered structure (Hot, Warm, Cold) for an effective introduction.
I am close to drafting the content by the section, starting with title, introduction, and contrasting screen hierarchies with semantic graphs.


**Constructing the Graph**

I'm now fully immersed in the graph-based nature of our protocol. I'm focusing on the nouns, represented by `SemanticEntity`, showcasing the TypeScript snippet and the crucial `relations` field, which embodies the graph edges. I am also working on `CognitiveReference` which handles pronouns, a critical component often neglected in current AI systems, and how this moves complexity to runtime. Finally, I'm working through the Universal Intent Ontology to exemplify how we can collapse thousands of commands into about 50 cognitive intents. I want to convey how this `UniversalIntent` TS interface demonstrates it.




# Beyond the GUI, Part 2: The Universal Protocol — Mapping Meaning, Not Screens

In Part 1, we established that the Graphical User Interface is a trap for AI. By forcing agents to navigate visual hierarchies (pixels and DOM trees), we guarantee brittleness. To achieve true Ambient Computing, we must bypass the presentation layer entirely. 

But if we bypass the GUI, what replaces it? 

Early in the design of the **Universal Semantic Interaction Runtime (USIR)**, we considered defining a universal XML template system—a markup language for multi-modal rendering. But we quickly realized that was just reinventing HTML. 

XML and DOMs are hierarchies (trees). But **human tasks are relationships (graphs).**

When a developer says, *"Run the test for the function I was editing before lunch,"* there is no single UI element on the screen that represents that command. The intent spans across time, file systems, and execution states. 

To solve this, we need a protocol that maps *meaning*. In this post, we will dive into `@usir/protocol`, the foundational package of our monorepo, and explore the TypeScript schemas that replace the 40-year-old paradigm of windows, icons, and menus.

---

### 1. The Nouns: Semantic Entities
In a traditional UI framework, the atomic unit of the world is a `Widget` or a `Node`. In USIR, the atomic unit is a `SemanticEntity`. 

A `SemanticEntity` strips away all visual presentation. It doesn't care if it's rendered as a button on a screen, a 3D hologram in XR, or spoken aloud through earbuds. It only cares about its semantic role and its relationship to other entities.

Here is the core interface from `packages/protocol/src/entities/index.ts`:

```typescript
export type EntityRole = 
  | 'source_file' 
  | 'function' 
  | 'error' 
  | 'terminal' 
  | 'test' 
  | 'ui_region';

export interface SemanticEntity {
  /** Unique Universal Resource Name, e.g., "file:///src/main.ts#L12" */
  id: string;
  
  /** Human readable name, e.g., "handleWebhookEvent" */
  name: string;
  
  role: EntityRole;
  
  /** 
   * Graph edges. Keys are relationship types, values are array of Entity IDs.
   * e.g., { "contains": ["id_1", "id_2"], "tested_by": ["file:///tests/main.test.ts"] }
   */
  relations: Record<string, string[]>;
}
```
Notice the `relations` record. This is the superpower of the Semantic Graph. Instead of traversing a DOM tree (`div > ul > li`), an AI agent traverses logical edges. Finding the tests for a specific function is no longer a multi-step UI navigation task; it is an $O(1)$ lookup in the graph.

### 2. The Pronouns: Cognitive References
This is where almost every current AI agent framework fails. They force strict noun usage.

If you want an agent to open a file, you have to say: *"Open `auth_service.ts`."* 
But humans don't talk like that. Humans rely heavily on spatial, temporal, and conversational context. We say: *"Open **that**,"* *"Fix **it**,"* or *"Compare this with the **previous** one."*

To make natural language a first-class interaction medium, our protocol must natively support pronouns. We define this as the `CognitiveReference` type:

```typescript
export type CognitiveReference = 
  | 'it' 
  | 'that' 
  | 'this'        // Conversational
  | 'previous' 
  | 'next'        // Temporal
  | 'above' 
  | 'below'       // Spatial
  | 'left'
  | 'right';
```
By placing this directly in the protocol, we decouple the *intent* from the *resolution*. The LLM doesn't need to figure out what "it" means in the moment. It simply outputs a payload with `target: 'it'`, and relies on the Stateful Runtime (which we will build in Part 4) to query the Interaction Memory and resolve the pronoun.

### 3. The Verbs: The Universal Intent Ontology
If you look at the command palette of a modern application like VS Code, you will find over 8,000 distinct commands (`cursor.openFile`, `python.runTest`, `git.stage`). 

But cognitively, humans don't have 8,000 intents. If you abstract human-computer interaction across IDEs, browsers, CAD software, and operating systems, you can collapse 90% of tasks into roughly **50 Universal Intents**.

Instead of application-specific commands, USIR uses a Universal Intent Ontology. Here is a slice of `packages/protocol/src/intents/index.ts`:

```typescript
export interface BaseIntent {
  type: string;
}

// --- L1: Navigation Intents ---
export interface OpenIntent extends BaseIntent {
  type: 'intent.navigation.open';
  target: string | SemanticEntity | CognitiveReference;
}

// --- L3: Information Intents ---
export interface ExplainIntent extends BaseIntent {
  type: 'intent.information.explain';
  target: SemanticEntity | CognitiveReference;
  verbosity: 'summary' | 'detailed';
}

// --- L6: Execution Intents ---
export interface ExecuteIntent extends BaseIntent {
  type: 'intent.execution.execute';
  target: SemanticEntity | CognitiveReference;
}

export type UniversalIntent = OpenIntent | ExplainIntent | ExecuteIntent /* ... */;
```

Every interaction, whether triggered by a voice command, a mouse click, or an XR gesture, is normalized into an `IntentEnvelope`.

```typescript
export interface IntentEnvelope<T extends UniversalIntent> {
  intentId: string; 
  actor: 'user' | 'agent';
  intent: T;
  context: {
    activeModality: 'voice' | 'text' | 'gesture' | 'mixed';
  };
  confidence: number; // 0.0 to 1.0
  timestamp: number;
}
```
This is the equivalent of a TCP/IP packet for interaction. The underlying application doesn't care *how* you triggered it; it just receives a standardized envelope instructing it to `intent.execution.execute` a specific `SemanticEntity`.

### 4. The State: The Semantic Snapshot
For the Intent Router (our LLM) to understand the user's command, it needs to know what the world currently looks like. In a traditional setup, you'd send a screenshot or a massive DOM dump. 

In USIR, applications project a `SemanticSnapshot`. 

```typescript
export interface SemanticSnapshot {
  timestamp: number;
  
  /** The 16ms tier: what the user is doing *right now* */
  hot: {
    activeEntityId: string | null;
    selections: string[]; 
  };

  /** The 150ms tier: contextual semantic enrichment */
  warm: {
    diagnostics: SemanticEntity[]; 
    resolvedSymbols: SemanticEntity[]; 
  };

  /** The 5s+ tier: global workspace awareness */
  cold: {
    visibleEntities: SemanticEntity[];
    runningTasks: SemanticEntity[];
  };

  /** Flat map of all entities currently in context for fast O(1) lookup */
  entityGraph: Record<string, SemanticEntity>;
}
```
This payload is hyper-dense. It contains no visual noise—no padding, no colors, no z-indexes. It is exactly the information an AI needs to route an intent, and absolutely nothing more. 

### The Protocol is the Foundation
By defining `@usir/protocol`, we have created the shared language that will allow the rest of our system to function. 
*   **Applications** (like VS Code) will translate their internal state into this `SemanticSnapshot`.
*   **The Intent Router** (the LLM) will parse natural language and output `UniversalIntents`.
*   **The Runtime** will hold the `entityGraph` in memory to resolve `CognitiveReferences`.

But there is a glaring engineering challenge staring us in the face. 
How do you generate this `SemanticSnapshot` from a legacy application like VS Code without completely freezing the UI thread? If you have to parse thousands of files and UI nodes every time the user moves their cursor, the editor will grind to a halt.

---
**Next up in Part 3:** *The Adapter Layer — Taming Legacy State in <16ms.* We will dive into `@usir/vscode-adapter` and unveil the Hot/Warm/Cold tiering architecture that makes real-time semantic projection possible.