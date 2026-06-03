# Part 3: Semantic Entities — When Everything Is a Node

> *Act I — The Foundation | Part 3 of 14*
>
> **Previously:** [Part 2](./usir-part2-intent-ontology.md) established USIR's Universal Intent Ontology — ~50 cognitive verbs layered L0 through L8 that give agents a finite grammar for human-software interaction. But verbs need nouns. Before the runtime can route `intent.navigation.locate`, it needs to know what things *exist* to be located. That's what this post is about.

---

The thesis of this post is simple but easy to underestimate: **everything in USIR is a node in a graph, and that graph is the only state the runtime ever sees.** The DOM, the VS Code file tree, a running process, a physical IoT thermostat, a spatial anchor in an XR scene — all of them are flattened into the same data structure before the runtime touches them. That structure is the `SemanticEntity`, and together entities form the `SemanticGraph`.

This sounds like an implementation detail. It is, in fact, an architectural wager. USIR is betting that you can strip away every application-specific data model and represent the world as a typed, relational graph of semantic nodes without losing the fidelity needed to execute meaningful actions. Whether that wager pays off depends entirely on how well `SemanticEntity` is designed. Let's find out.

---

## The Atom: `SemanticEntity`

Here is the complete interface from `packages/protocol/src/entities/index.ts`:

```typescript
/**
 * The atomic semantic unit. Apps expose these; the runtime never sees UI.
 */
export interface SemanticEntity {
  /** Unique Universal Resource Name, e.g. "file:///src/main.ts#L12" */
  id: string;
  /** Semantic role — what *kind* of thing this is */
  role: EntityRole;
  /** Human-readable name shown in disambiguation */
  displayName: string;
  /** Optional context — file path, function signature, error message, etc. */
  context?: Record<string, unknown>;
  /** Spatial position (screen coordinates or 3D volume) */
  spatial?: SpatialBounds;
  /** Audio fingerprint for voice-first clients */
  audioFingerprint?: AudioFingerprint;
  /** Free-form attributes: color, size, style, semantics */
  attributes: Record<string, unknown>;
  /** Graph edges — relations to other entities */
  relations: EntityRelation[];
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** Source adapter that produced this entity (e.g. "vscode", "browser") */
  source: string;
}
```

Nine fields. Let's walk through each one, because every design decision here carries weight.

### `id: string` — the URN contract

The `id` is not a random UUID. USIR specifies it as a Universal Resource Name in a scheme meaningful to the producing adapter:

- VS Code entities: `file:///path/to/src/main.ts#L42` — the same URI format LSP uses, which is not accidental
- Browser DOM entities: `dom://button#submit-btn.primary[3]` — tag + id + classes + sibling index
- IoT entities: `iot://device/thermostat-living-room/attribute/temperature`
- XR anchors: `xr://anchor/kitchen-counter-north-edge`

The format is not enforced by the type system (it's just `string`), but the adapter conventions matter. The Tiered Snapshot Engine and the federated P2P layer both depend on `id` being globally stable across adapter re-invocations. If a DOM adapter re-numbers its `nth-child` index on every scroll event, `CognitiveReference.recency` — "the thing I was just looking at" — breaks. The `buildElementId` function in the browser adapter is careful to encode both structural identity (tag, id, class) and positional identity (nth index) precisely to avoid this.

### `role: EntityRole` — the closed taxonomy

The `EntityRole` type is a discriminated union of 27 string literals, organized into four conceptual tiers:

```typescript
export type EntityRole =
  // Code/Development
  | 'source_file' | 'function' | 'class' | 'variable'
  | 'module'      | 'package'  | 'test'  | 'diagnostic'
  | 'terminal'    | 'documentation'
  // UI regions
  | 'ui_region' | 'panel' | 'form_field' | 'data_table'
  // Runtime constructs
  | 'error'    | 'warning'  | 'task'     | 'agent'
  | 'user'     | 'document' | 'meeting'  | 'project'
  | 'relationship'
  // Physical world (Stage 2 expansion)
  | 'physical_device' | 'spatial_anchor' | 'environmental_sensor'
  // Generic fallbacks
  | 'unknown';
```

The taxonomy is doing a lot of work. `role` is the primary index key in the `SemanticGraph` — every `addEntity` call updates a `byRole: Map<string, Set<string>>` index. When the LLM router needs to find all `function` entities near the cursor, it uses `byRole.get('function')` rather than scanning the full graph. The `role` field is not a cosmetic label; it is the query surface.

Notice the three-tier organization: **code entities** (what IDE adapters produce), **UI entities** (what browser adapters produce), and **physical/IoT entities** (what the Stage 2 adapters produce). The `task`, `agent`, `user`, `meeting`, and `project` roles are for the runtime's own internal bookkeeping — they represent entities that USIR itself creates to track work, not entities extracted from applications.

And then there is `'unknown'`. We'll come back to this.

### `spatial?: SpatialBounds` — why coordinates live on the entity, not the renderer

The most architecturally revealing field is `spatial`. In traditional UI frameworks, coordinates live in the rendering layer — you ask the layout engine "where is this widget?" The widget doesn't know its own position. USIR inverts this. Every entity *carries* its own spatial footprint, and that footprint can be either 2D or 3D:

```typescript
export interface SpatialBounds2D {
  x: number; y: number; width: number; height: number;
}

export interface SpatialVolume {
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  rotation?: { x: number; y: number; z: number; w: number };
}

export type SpatialBounds = SpatialBounds2D | SpatialVolume;
```

The `SpatialVolume` variant has a quaternion `rotation` field. This is not speculative — the XR adapter (`@usir/adapters-xr`) uses `SpatialVolume` for spatial anchors and XR scene objects. When a user says "that panel over there" while wearing XR glasses, the reference resolver uses `spatial` coordinates to rank candidates by proximity to the user's gaze vector. The spatial coordinates are not display hints; they are the substrate for spatial `CognitiveReference` resolution.

Putting `spatial` on the base entity rather than a subtype has a cost: every VS Code `function` entity carries an unused optional `spatial` field. The design accepts this memory overhead in exchange for a flat type hierarchy — the runtime never needs to type-narrow or cast.

### `audioFingerprint?: AudioFingerprint` — voice-first as a first-class citizen

The audio fingerprint is the most voice-specific field on the entity:

```typescript
export interface AudioFingerprint {
  phoneticName: string;      // "Alpha", "Bravo", "main-dot-ts"
  spokenDescription: string; // "the wide blue box near the top left"
  spokenId: string;          // TTS-speakable identifier
}
```

`phoneticName` is a phonetically friendly alias. Function names like `authenticateUser` are straightforward to speak; names like `src/__tests__/e2e/auth.spec.ts` are not. The adapter can pre-compute a NATO-phonetic alias ("Alpha Echo"). The voice disambiguation layer can then prompt: *"Did you mean 'Alpha Echo' — the auth spec file?"*

`spokenDescription` is a natural language description of position and appearance, pre-computed from `spatial` and `displayName`. When the disambiguation waypoint fires and the TTS engine needs to list candidates, it reads `spokenDescription` rather than trying to generate descriptions on the fly from raw coordinates.

This field is optional — most current adapters don't populate it. But its presence on the *protocol* type is a forcing function: it ensures that future adapter authors think about voice-first ergonomics at entity construction time, not as an afterthought.

### `relations: EntityRelation[]` — the graph, not the tree

This is the field that makes `SemanticEntity` a graph node rather than a tree node:

```typescript
export type RelationKind =
  | 'contains' | 'child_of'  | 'parent_of' | 'references'
  | 'depends_on' | 'relates_to' | 'next_to'  | 'above'
  | 'below'    | 'created_by' | 'assigned_to' | 'generated_from'
  | 'implements' | 'extends' | 'overrides' | 'calls';

export interface EntityRelation {
  kind: RelationKind;
  targetId: string;
  confidence?: number; // for inferred relations
}
```

A function entity in a VS Code adapter doesn't just know it lives in a file — it knows it `calls` other functions, `depends_on` imported modules, `implements` an interface. These edges come from LSP diagnostics, which the VS Code cold snapshot ingests. A DOM entity knows it is `child_of` its parent element. An IoT temperature sensor entity is `next_to` a humidity sensor because the MQTT topic namespace encodes their physical proximity.

The `confidence` field on `EntityRelation` is specifically for inferred edges — relations that LSP or the LLM inferred rather than directly observed. A `calls` edge extracted from a static parse is `confidence: 1.0`. A `relates_to` edge inferred because two functions have similar naming conventions is `confidence: 0.6`. The runtime can filter by confidence when building context windows.

---

## The Factory: `createEntity`

Every entity in USIR is created through a single factory function:

```typescript
export function createEntity(
  partial: Partial<SemanticEntity> & Pick<SemanticEntity, 'id' | 'role' | 'displayName'>
): SemanticEntity {
  return {
    relations: [],
    attributes: {},
    updatedAt: Date.now(),
    source: 'unknown',
    ...partial,
  };
}
```

This is deliberately minimal. `createEntity` enforces three required fields (`id`, `role`, `displayName`) and fills in safe defaults for everything else. The `...partial` spread at the end means callers can override any default including `source`.

The immutability story here is important. `createEntity` returns a plain object literal — it is not a class instance with methods. There is no `.update()`, no `.addRelation()`. To modify an entity, you call `addEntity(graph, { ...existingEntity, updatedAt: Date.now(), relations: [...] })`. This pattern makes provenance straightforward: every structural change to an entity produces a new object with a new `updatedAt` timestamp. The L0.5 Provenance layer (covered in Part 5) depends on this — it hooks into `addEntity` to record mutation events, and it can only do so reliably if entity updates go through the graph API rather than mutating entity objects in place.

---

## The Container: `SemanticGraph`

Entities don't float in isolation. They are organized into a `SemanticGraph`:

```typescript
export interface SemanticGraph {
  nodes: Map<string, SemanticNode>;
  edges: EntityRelation[];
  byRole: Map<string, Set<string>>;
  bySource: Map<string, Set<string>>;
  capturedAt: number;
  version: number;
}

export interface SemanticNode {
  entity: SemanticEntity;
  outbound: string[];   // ids this node points to
  inbound: string[];    // ids that point to this node
}
```

Three things are worth noting:

**Dual representation of edges.** The graph stores edges twice: once in the flat `edges` array (for iteration and serialization), and again in `SemanticNode.outbound`/`inbound` adjacency lists (for O(1) graph traversal). `addEntity` maintains both structures in sync. The redundancy is intentional — serializing `edges` as a flat list is cheap for over-the-wire formats; traversing adjacency lists during intent routing is fast.

**Two secondary indices.** `byRole` and `bySource` are `Map<string, Set<string>>` indices populated automatically by `addEntity`. These are the query accelerators: when the LLM router asks "what functions are visible right now?", it calls `byRole.get('function')` rather than scanning all nodes. `bySource` enables adapter isolation — the VS Code adapter can clear its own entities without touching browser adapter entities by filtering on source.

**`version` as a staleness sentinel.** Every `addEntity` or `removeEntity` call increments `graph.version`. The snapshot engine uses this to detect when the Cold tier graph has changed and whether the LLM router's last context window is stale. The Federated P2P layer (Part 11) uses `version` as the basis for its Yjs CRDT merge vector.

The BFS traversal function is worth showing:

```typescript
export function bfs(
  graph: SemanticGraph,
  startId: string,
  maxDepth: number,
  visitor: (entityId: string, depth: number) => boolean | void,
): void {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (visitor(id, depth) === false) return; // early exit
    if (depth >= maxDepth) continue;
    const node = graph.nodes.get(id);
    if (!node) continue;
    for (const outbound of node.outbound) {
      if (!visited.has(outbound)) {
        queue.push({ id: outbound, depth: depth + 1 });
      }
    }
  }
}
```

The comment in `graph/index.ts` says it plainly: *"BFS traversal up to a depth limit. Critical for the Tiered Snapshot Engine — we must never walk the full graph on the UI thread."* `maxDepth` is the safety valve. The `ColdTier.projectSubgraph` method calls `bfs` with depth 3 by default — enough to surface the active entity, its direct dependencies, and their dependencies. Any deeper and you risk walking the entire codebase graph on the extension host thread.

---

## The DOM Adapter: Where Theory Meets `document.createTreeWalker`

The `SemanticEntity` spec is clean. The DOM is not. The browser adapter's `dom-adapter.ts` is where the design confronts real-world messiness.

### The `TAG_ROLE_MAP`: a declaration of intent

```typescript
const TAG_ROLE_MAP: Record<string, EntityRole> = {
  A:        'ui_region',
  BUTTON:   'ui_region',
  INPUT:    'form_field',
  SELECT:   'form_field',
  TEXTAREA: 'form_field',
  FORM:     'form_field',
  IMG:      'ui_region',
  VIDEO:    'ui_region',
  CANVAS:   'ui_region',
  NAV:      'panel',
  HEADER:   'panel',
  FOOTER:   'panel',
  ASIDE:    'panel',
  MAIN:     'panel',
  SECTION:  'panel',
  ARTICLE:  'document',
  P:        'document',
  H1:       'document', H2: 'document', H3: 'document',
  TABLE:    'data_table',
  DIALOG:   'ui_region',
};
```

This map is the adapter's theory of the web's semantic structure. Notice the choices: `NAV`, `HEADER`, `FOOTER`, `ASIDE`, `MAIN`, and `SECTION` are all `panel` — they're treated as structural containers. `P`, `H1–H3`, and `ARTICLE` are `document` — they carry readable content. `INPUT`, `SELECT`, `TEXTAREA`, and `FORM` are `form_field` — interactive inputs.

The implicit decision here is that USIR does not try to distinguish between a navigation panel and a footer panel at the `EntityRole` level — that nuance lives in `attributes.tagName` and the entity's `context`. This is a deliberate choice to keep the role taxonomy small. The tradeoff is that intent routing on structural containers must inspect `attributes` rather than `role` alone.

### The ARIA fallback chain: `getRoleForElement`

USIR does not blindly trust the HTML tag. It also reads ARIA attributes:

```typescript
function getRoleForElement(element: Element): EntityRole {
  const tag = element.tagName.toUpperCase();
  const role = element.getAttribute('role');
  if (role === 'button' || role === 'tab' || role === 'menuitem') return 'ui_region';
  if (role === 'dialog' || role === 'alertdialog') return 'ui_region';
  if (role === 'form' || role === 'search') return 'form_field';
  if (role === 'navigation') return 'panel';
  if (role === 'main' || role === 'region') return 'panel';
  const ariaRole = element.getAttribute('aria-role');
  if (ariaRole === 'button') return 'ui_region';
  return TAG_ROLE_MAP[tag] ?? 'unknown';
}
```

The lookup chain is: `role` attribute → `aria-role` attribute → `TAG_ROLE_MAP` → `'unknown'`. This is the correct order: explicit ARIA semantics override HTML tag defaults. A `<div role="button">` is correctly identified as `ui_region`. A `<span role="navigation">` becomes `panel`.

The `?? 'unknown'` at the end is the escape hatch. We'll return to it.

### `getDisplayName`: the voice-readability problem

```typescript
function getDisplayName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  const title = element.getAttribute('title');
  if (title) return title;
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return placeholder;
  const text = element.textContent?.trim().slice(0, 80);
  if (text) return text;
  return `<${element.tagName.toLowerCase()}>`;
}
```

The priority chain — `aria-label` → `title` → `placeholder` → `textContent` → tag fallback — is the accessibility specification translated into USIR's voice-first needs. `aria-label` is the highest priority because it is the human-intent description of the element. When the TTS engine needs to say "did you mean the Submit Order button?", it is reading `displayName`, and `displayName` comes from this chain.

The 80-character truncation on `textContent` is a pragmatic guard against entities whose display name would be an entire paragraph. The tradeoff is lossy for content-heavy elements — a long `<p>` tag might produce a truncated displayName that cuts off mid-sentence. This is acceptable for the current voice disambiguation use case (the TTS just needs enough to distinguish one candidate from another), but would need revisiting for accessibility tooling that needs the full text.

### `buildElementId`: stable identity under DOM mutations

```typescript
function buildElementId(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList).map((c) => `.${c}`).join('');
  const nth = element.parentElement
    ? Array.from(element.parentElement.children).indexOf(element) + 1
    : 1;
  return `dom://${tag}${id}${classes}[${nth}]`;
}
```

For `<button id="submit-btn" class="primary">`, this produces `dom://button#submit-btn.primary[3]`. The `#id` fragment makes the id stable for elements with a DOM id. The class list adds semantic specificity. The `[nth]` positional suffix handles identical-looking siblings (e.g., a list of icon buttons with the same classes).

The weakness is class list instability. React and CSS Modules both generate class names that include a hash suffix (`Button_primary__3kX9p`). These change on every build. An entity id like `dom://button.Button_primary__3kX9p[2]` is not stable across deployments, which means `InteractionMemory`'s recent-entity ring buffer will find stale entries. This is a real problem for production SPAs that USIR has not yet solved — the design acknowledges it by leaning on `#id` where available and using the positional suffix as a last resort.

---

## Two Export Functions: `buildDomGraph` vs `buildViewportEntities`

The adapter exposes two ways to extract entities from the DOM, and the difference between them matters.

### `buildDomGraph`: the complete subgraph

```typescript
export function buildDomGraph(root: Element, maxDepth: number = 10): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  walkDom(root, null, 0, maxDepth, entities);
  return entities;
}
```

`buildDomGraph` performs a recursive depth-first walk of the DOM tree, calling `elementToEntity` on every visible element. The result is a complete `SemanticEntity[]` covering the entire DOM subtree up to `maxDepth`. This is used by the Cold tier snapshot — the one that runs in the background without a latency budget.

The `isVisible` check inside `walkDom` filters out `display: none` and zero-size elements, but it does not filter by viewport. On a large SPA, `document.body` might have thousands of visible elements that are scrolled out of view. `buildDomGraph` will include all of them. This is by design — the Cold tier is meant to capture the full semantic context of the application, not just what's visible.

### `buildViewportEntities`: the fast hot/warm path

```typescript
export function buildViewportEntities(root: Element): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node): number {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!VISIBLE_ROLES.has(tag)) return NodeFilter.FILTER_SKIP;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || ...) return NodeFilter.FILTER_REJECT;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
      if (!isInViewport(rect)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    entities.push(elementToEntity(node as Element));
  }
  return entities;
}
```

`buildViewportEntities` uses `document.createTreeWalker` with a `NodeFilter` that aggressively rejects non-visible, non-semantic, and out-of-viewport elements. The `FILTER_REJECT` return (as opposed to `FILTER_SKIP`) tells the `TreeWalker` not to recurse into rejected nodes' children. This is the key performance win: a `<div style="display:none">` containing 500 child elements costs one `getComputedStyle` call with `TreeWalker`, versus 500 calls with `querySelectorAll('*')`.

The migration from `querySelectorAll('*')` to `TreeWalker` is documented in `IMPLEMENTATION.md` as a fix for "SPA scalability." This is the correct framing. On a React app with a deep component tree, `querySelectorAll('*')` walks thousands of elements regardless of visibility. `TreeWalker` with `FILTER_REJECT` prunes entire DOM subtrees at the first invisible ancestor. The result is that the Warm tier snapshot — which uses `buildViewportEntities` — stays within its 150ms latency budget even on complex SPAs.

---

## Architecture Diagram: Entity Lifecycle

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Adapter (browser / vscode)                    │
│                                                                      │
│  DOM / LSP / IoT                                                     │
│       │                                                              │
│       ▼                                                              │
│  elementToEntity()          createEntity()  ←── factory              │
│  getRoleForElement()        ─────────────────────────────────────    │
│  getDisplayName()                 │                                  │
│  buildElementId()                 ▼                                  │
│                            SemanticEntity { id, role,               │
│                              displayName, spatial,                   │
│                              attributes, relations, ... }            │
│                                   │                                  │
│          ┌────────────────────────┤                                  │
│          │                        │                                  │
│          ▼                        ▼                                  │
│  buildViewportEntities()   buildDomGraph()                           │
│  (TreeWalker, in-viewport) (recursive walk, full tree)               │
│          │                        │                                  │
│          ▼                        ▼                                  │
│       Warm Tier               Cold Tier                              │
│      (≤150ms)                (background)                            │
└──────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         SemanticGraph                                │
│                                                                      │
│  nodes: Map<id, SemanticNode>     byRole: Map<role, Set<id>>        │
│  edges: EntityRelation[]          bySource: Map<source, Set<id>>     │
│  version: number                  capturedAt: number                 │
│                                                                      │
│  addEntity() ──► maintains nodes + edges + byRole + bySource         │
│  bfs()       ──► depth-limited graph traversal (no UI thread block)  │
│  findEntities() ──► predicate scan, used by intent router            │
└──────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                    SemanticSnapshot { hot, warm, cold }
                    (covered in Part 4)
```

---

## The VS Code Side: Entities from LSP

The browser adapter builds entities by walking the DOM. The VS Code adapter builds entities by walking the Language Server Protocol metadata. The source differs, but the output is the same `SemanticEntity` type.

The VS Code `ColdTier` class is the clearest example of the SemanticGraph in action within an IDE context:

```typescript
export class ColdTier {
  private graph: SemanticGraph = createSemanticGraph();
  private lspMetadata: Map<string, LspEntityMetadata> = new Map();
  private maxDepth: number = 3;

  public addEntity(entity: SemanticEntity, metadata?: LspEntityMetadata): void {
    addEntity(this.graph, entity);
    if (metadata) this.lspMetadata.set(entity.id, metadata);
    this.scheduleUpdate();
  }

  public projectSubgraph(rootId: string, maxDepth?: number): SemanticEntity[] {
    const depth = maxDepth ?? this.maxDepth;
    const out: SemanticEntity[] = [];
    bfs(this.graph, rootId, depth, (id) => {
      const node = this.graph.nodes.get(id);
      if (node) out.push(node.entity);
    });
    return out;
  }

  public toSnapshot(): ColdSnapshot {
    return {
      tier: 'cold',
      graph: this.graph,
      lspMetadata: Object.fromEntries(this.lspMetadata),
      capturedAt: Date.now(),
      latencyBudgetMs: 5000,
    };
  }
}
```

A few things worth noting:

`lspMetadata` is a parallel Map that stores LSP-specific information (diagnostics, hover data, symbol information) keyed by entity id, alongside the generic graph. This is a deliberate separation: the `SemanticGraph` stays protocol-agnostic, while the LSP-specific data lives in a side channel. The LLM router can query `getLspMetadata(entityId)` when it needs diagnostic context for a `refactor` intent, without polluting the base entity's `attributes`.

`projectSubgraph` is the Cold tier's primary output consumer. When the LLM router assembles a context window for a complex intent — say, `intent.manipulation.refactor` on the currently active function — it calls `projectSubgraph(activeFunctionId, 3)`. This gives it the function entity, its direct `calls` edges (the functions it calls), the entities those functions `depend_on`, and so on up to depth 3. This BFS-bounded projection is what keeps the context window tractable without losing critical dependency context.

The 1-second debounce in `scheduleUpdate` is the cold tier's admission that it's not trying to be real-time. LSP symbol tables take seconds to update; debouncing ensures the graph doesn't thrash on every keystroke.

---

## The Critical Take: `'unknown'` Is a Smell, Not a Feature

The `EntityRole` taxonomy ends with `'unknown'`. This single literal is the most honest thing in the codebase, and also its biggest design liability.

`'unknown'` appears at the end of `getRoleForElement`:

```typescript
return TAG_ROLE_MAP[tag] ?? 'unknown';
```

And at the end of the full `EntityRole` type definition:

```typescript
// Generic fallbacks
| 'unknown';
```

`'unknown'` is the adapter saying "I can see this element exists, but I have no idea what it means." In practice, real-world SPAs produce a significant fraction of `'unknown'` entities:

- Custom web components (`<my-app-sidebar>`, `<x-drawer>`) — USIR sees the tag, can't map it to a role
- Library-specific containers — React portals, styled-components wrappers, headless UI primitives
- Elements with only `aria-role` attributes that the current `getRoleForElement` doesn't cover (e.g., `aria-role="listbox"` is not handled)
- Deep nesting of `<div>` and `<span>` elements with semantic meaning derived entirely from CSS class names

An `'unknown'` entity ends up in the graph with no role indexing. `byRole.get('unknown')` will accumulate a growing pile of unclassifiable DOM noise. The intent router can filter `'unknown'` entities out of candidates, but this means those elements are invisible to voice commands. A custom `<app-searchbar>` component — even one the user interacts with constantly — is silent to USIR until the adapter author explicitly extends `TAG_ROLE_MAP` or the ARIA fallback chain.

This is the fundamental tension in any closed taxonomy: the taxonomy is only as good as the fidelity of the world it was designed for. The current `EntityRole` set was clearly designed with VS Code and standard web UIs in mind. It does not cover XR-native UI patterns (what role is a floating holographic dial?), game engine entities (what role is a `GameObject`?), or enterprise application frameworks (SAP Fiori's `sap.m.Table` is not a `data_table` without explicit mapping).

The ARIA fallback chain is partially an answer to this — ARIA is the web's own semantic layer, and USIR correctly piggybacks on it. But ARIA misuse in production SPAs is widespread. Elements marked `aria-label` with placeholder strings, form fields with `role="presentation"`, modals wrapped in `<div>` containers with no accessible roles — all of these degrade `getRoleForElement`'s fidelity in exactly the production environments where USIR needs to work most reliably.

Two design responses exist in the codebase, neither fully implemented: the `ZeroShotVLMAdapter` specification (in `docs/semantic-horizon/01-zero-shot-adapter.md`) would use a vision-language model to compile arbitrary screenshots into `SemanticSnapshots` — a fallback that sidesteps the taxonomic problem entirely. And the RFC process in `docs/ontology/README.md` provides a mechanism for community-contributed role extensions. Both are correct responses. Neither is tested in production at scale.

---

## What This Means for the Rest of the Stack

The `SemanticEntity` and `SemanticGraph` types are load-bearing in ways that only become clear as the series continues.

**Part 4 (Tiered Snapshot Engine)** is built entirely on the assumption that `SemanticEntity` is fast to create and cheap to serialize. The 16ms Hot tier budget is achievable because `createEntity` is a plain object literal spread with no side effects.

**Part 5 (L0.5 Provenance)** works by intercepting `addEntity` calls to record mutations. The provenance layer's correctness guarantee depends on entities being updated exclusively through `addEntity`, which is why `createEntity` returns an immutable-by-convention plain object.

**Part 7 (LLM Router and Topological Executor)** uses `byRole`, `bySource`, and `bfs` as its primary query primitives. The router's performance characteristics are directly determined by the graph index design.

**Part 11 (Federation)** maps the `SemanticGraph` to a Yjs CRDT document. The `version` field and flat `edges` array are the data the CRDT merges across peers. The graph's design choices — flat edge list, adjacency lists as derived data — were made with federation in mind.

The graph is not an implementation detail. It is the protocol.

---

## Summary

`SemanticEntity` is USIR's claim that the identity of a software artifact — whether a TypeScript function, a DOM button, an IoT sensor, or an XR spatial anchor — can be described in nine fields without losing the information the runtime needs to act on it. `SemanticGraph` is the claim that the *relationships* between those artifacts can be traversed efficiently at the layer above the UI, with role and source indices supporting O(1) filtered queries.

The browser adapter's `buildViewportEntities` shows these claims being tested against the real DOM: `TreeWalker` with aggressive rejection filters, an ARIA fallback chain, and a positional id scheme that balances stability with SPA realism. The VS Code `ColdTier` shows them being tested against LSP: entities get a parallel metadata map for IDE-specific data, and `projectSubgraph` delivers BFS-bounded dependency graphs to the LLM router.

The `'unknown'` escape hatch is the honest acknowledgment of where the taxonomy falls short. It is a smell not because it exists but because the adapter does not surface it loudly — it quietly inserts `'unknown'` entities into the graph where they sit, invisible to voice commands and intent routing. A production-grade USIR deployment would need either a richer taxonomy, an ARIA-strict DOM curation policy, or the ZeroShot VLM fallback to handle the long tail of real-world UI patterns.

Next in Part 4: the Tiered Snapshot Engine. We'll see how `SemanticEntity` objects extracted via `buildViewportEntities` and `buildDomGraph` get organized into the Hot (≤16ms), Warm (≤150ms), and Cold (async) tiers — and why "16ms" is not a round number but a single animation frame budget that determines what USIR can promise about voice command latency.

---

*USIR Deep-Dive Blog Series — Act I: The Foundation*
*← [Part 2: The Universal Intent Ontology](./usir-part2-intent-ontology.md) | [Part 4: The Tiered Snapshot Engine](./usir-part4-snapshot-engine.md) →*

*Code references: `packages/protocol/src/entities/index.ts`, `packages/protocol/src/graph/index.ts`, `adapters/browser/src/dom/dom-adapter.ts`, `adapters/vscode/src/snapshot/cold.ts`*
