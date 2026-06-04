# Part 6: Interaction Memory — Teaching the Runtime to Forget Strategically

> **Series:** Decoding the Post-GUI Runtime — Act II: The Machine in Motion  
> **Previous:** [Part 5 — L0.5 Provenance: The Layer Nobody Talks About](#)  
> **Next:** [Part 7 — The LLM Router and Topological Executor](#)

---

The second-biggest failure of voice assistants — after ontology — is memory.

Not persistent memory. Not long-term user modeling. Plain, boring, *session* memory. The kind that lets you say "open that file" and have the runtime know what "that" means. The kind that lets "compare it with the previous one" work without you reciting a full path. The kind that makes "the function below it" unambiguous when there are forty functions on screen.

Every voice assistant ships without this, then wonders why users revert to the keyboard. USIR takes a direct swing at the problem with `InteractionMemory` and its `CognitiveReference` resolver system. This post goes implementation-deep into both: what they are, how they work in code, where they shine, and where the seams show.

---

## The Core Insight: Humans Don't Speak in Identifiers

Before touching code, it's worth internalizing why this is hard.

When a software engineer opens a file picker and double-clicks `src/auth/jwt-validator.ts`, they are performing a fully qualified reference. There is no ambiguity. The OS hands them an inode.

When that same engineer says "open the validator" to a voice interface, they're doing something categorically different. They're issuing a *cognitive* reference: a pointer into their working memory, not into a file tree. The word "validator" is a compression of context — "the file I was looking at ten minutes ago, the one in the auth folder, the one with JWT in the name, the one I was just complaining about to a colleague."

The computational task is to *decompress* that reference back into a concrete entity ID. No filesystem has an API for that. No language server protocol has a `resolveHumanMemory` request. USIR has to build it from scratch.

The protocol-level answer lives in `packages/protocol/src/memory/index.ts`. Four types of cognitive reference, each mapping to a different kind of human memory:

```typescript
// packages/protocol/src/memory/index.ts

export type ContextKind = 'temporal' | 'conversational' | 'spatial' | 'semantic';

export interface BaseReference {
  refId: string;
  kind: ContextKind;
  confidence: number;
  resolvedEntityId?: string;  // Filled in by the resolver, not the LLM
}

/**
 * "the file I opened yesterday" / "the last test I ran"
 */
export interface TemporalReference extends BaseReference {
  kind: 'temporal';
  relativeTime: string;          // "yesterday", "earlier today", "before lunch"
  eventType?: 'opened' | 'edited' | 'executed' | 'discussed' | 'created' | 'closed';
}

/**
 * "that one" / "the previous one" / "the first thing they said"
 */
export interface ConversationalReference extends BaseReference {
  kind: 'conversational';
  stepsBack?: number;            // How far back in the history ring
  position?: 'previous' | 'next' | 'first' | 'last' | 'most_recent';
  topic?: string;
}

/**
 * "the thing below that" / "the panel to the right" / "the wider one"
 */
export interface SpatialReference extends BaseReference {
  kind: 'spatial';
  anchorEntityId?: string;
  direction?: 'below' | 'above' | 'left' | 'right' | 'next_to' | 'inside' | 'overlapping';
  sizeRelation?: 'wider' | 'taller' | 'smaller' | 'larger' | 'bigger';
  visualAttribute?: string;
}

/**
 * "the design discussion we had earlier" / "the JWT bug"
 */
export interface SemanticReference extends BaseReference {
  kind: 'semantic';
  description: string;
  topic?: string;
}

export type CognitiveReference =
  | TemporalReference
  | ConversationalReference
  | SpatialReference
  | SemanticReference;
```

Four types. Four fundamentally different resolution strategies. The `CognitiveReference` union is what USIR's LLM router emits instead of an `entityId` when it parses a command that contains a pronoun, a relative term, or a vague description. The `resolvedEntityId` field is intentionally absent at parse time — it's filled in *later* by the `InteractionMemory` resolver, whose job is to translate cognitive context into graph coordinates.

This separation — *what kind of reference* vs. *which specific entity* — is the key design decision that makes the whole system tractable. The LLM classifies the reference type. The runtime resolves it. Neither does both.

---

## The InteractionMemory Class: What the Runtime Actually Remembers

The resolution engine is `packages/runtime/src/memory/interaction-memory.ts`. Let's look at the full class skeleton before going resolver-by-resolver:

```typescript
// packages/runtime/src/memory/interaction-memory.ts

const HISTORY_LIMIT = 50;

export class InteractionMemory implements Persistable<InteractionMemoryData> {
  private history: string[] = [];          // Ring buffer of entity IDs, most-recent first
  private lastDiscussed: string | null = null;   // The current "it"
  private conversationHistory: ConversationTurn[] = [];
  private sessionStartedAt: number = Date.now();
  private userId: string;
  private storage: Storage;

  constructor(userId: string, storage?: Storage) {
    this.userId = userId;
    this.storage = storage ?? new JsonFileStorage();
  }

  public pushToHistory(entityId: string, options?: { intentId?: string; rawInput?: string }): void {
    this.history = this.history.filter((id) => id !== entityId);  // Deduplicate
    this.history.unshift(entityId);                               // Prepend (most recent first)
    if (this.history.length > HISTORY_LIMIT) this.history.pop(); // Evict oldest
    this.lastDiscussed = entityId;
    if (options?.rawInput) {
      this.conversationHistory.push({
        turnId: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        rawInput: options.rawInput,
        resolvedIntentId: options.intentId,
        touchedEntityIds: [entityId],
      });
    }
  }

  public resolve(reference: CognitiveReference, candidateEntities: SemanticEntity[]): string | null {
    switch (reference.kind) {
      case 'temporal':       return this.resolveTemporal(reference);
      case 'conversational': return this.resolveConversational(reference);
      case 'spatial':        return this.resolveSpatial(reference, candidateEntities);
      case 'semantic':       return this.resolveSemantic(reference, candidateEntities);
    }
  }
  // ...
}
```

Three things are worth noting before diving into the resolvers.

**First, the ring buffer.** `history` is a 50-slot array of entity IDs, ordered most-recent-first. Every time an entity is touched — focused, edited, read, discussed — it gets `pushToHistory`'d. The deduplication-before-prepend pattern means the buffer tracks *unique recent entities*, not a raw event log. If you keep coming back to `jwt-validator.ts`, it stays at position 0, not buried by its own repetitions.

**Second, `lastDiscussed`.** This is "it" — the most recently-touched entity at any given moment. When a command contains a bare pronoun (`"explain it"`, `"delete it"`, `"rename it"`), the resolver doesn't even need to look at the history ring. `lastDiscussed` is the answer.

**Third, the `Storage` interface.** The constructor accepts an optional `Storage` dependency. The default is `JsonFileStorage` (flat JSON, in-process). The alternative is `SqliteStorage`. This design means session memory can be swapped between in-memory, file-backed, and database-backed without touching the resolver logic. We'll come back to what this implies for cross-session memory.

---

## The Four Resolvers, In Detail

### 1. Temporal Resolver: "The File I Opened Yesterday"

```typescript
private resolveTemporal(ref: TemporalReference): string | null {
  if (!ref.eventType) {
    return this.history[0] ?? null;  // No event filter: most recent entity
  }
  return this.history[0] ?? null;    // Event filter: currently falls back to same
}
```

The temporal resolver is honest about what it can and cannot do. In its current form, it returns the most recent entity from the history ring regardless of the `eventType` or `relativeTime` constraints. A reference like "the file I edited yesterday" resolves to the same entity as "the thing I just looked at."

This is not a bug — it's a documented simplification. The protocol type is fully expressive: `TemporalReference` has `relativeTime` and `eventType` fields that could, in principle, filter the history ring by timestamp and action type. The `ConversationTurn` records in `conversationHistory` have `timestamp` and `touchedEntityIds`, which would support filtering by time window. The architecture is right; the implementation is conservative.

What's needed to make temporal resolution complete: each `pushToHistory` call needs to record the event type alongside the entity ID, and `resolveTemporal` needs to walk `conversationHistory` backward with a time window derived from `relativeTime`. That's a well-scoped implementation gap, not an architecture problem.

### 2. Conversational Resolver: "The Previous One"

```typescript
private resolveConversational(ref: ConversationalReference): string | null {
  const pos = ref.position ?? 'most_recent';
  switch (pos) {
    case 'most_recent':
    case 'previous':  return this.history[0] ?? null;
    case 'next':      return this.history[1] ?? null;
    case 'first':     return this.history[this.history.length - 1] ?? null;
    case 'last':      return this.history[0] ?? null;
  }
  if (ref.stepsBack != null) {
    return this.history[ref.stepsBack] ?? null;
  }
  return null;
}
```

The conversational resolver is the simplest and in practice the most useful. It answers the class of commands that reference position in the interaction sequence: "the previous one," "the first one you mentioned," "go back two steps."

The implementation is index arithmetic on the history ring. `history[0]` is the most recent entity. `history[N-1]` is the oldest entity the ring still holds. `stepsBack` lets the LLM router say "2 back" explicitly when it can parse that from the user's utterance.

One subtlety: `'previous'` and `'most_recent'` both map to `history[0]`. From the user's perspective, "the one I was just looking at" and "the previous one" mean the same thing in most contexts. The distinction would matter if you were modeling "previous relative to a non-most-recent entity," but that's an edge case the implementation sensibly ignores.

The conversational resolver is where the ring buffer's deduplication earns its keep. Without it, revisiting a file multiple times would bury other entities in the history, making "go back to the other one" unreliable. With deduplication, position in the ring tracks *recency of unique entities*, not raw interaction frequency.

### 3. Spatial Resolver: "The Panel on the Right"

```typescript
private resolveSpatial(ref: SpatialReference, candidates: SemanticEntity[]): string | null {
  if (!ref.anchorEntityId) return null;
  const anchor = candidates.find((e) => e.id === ref.anchorEntityId);
  if (!anchor?.spatial) return null;

  const matches = candidates.filter((e) => {
    if (e.id === ref.anchorEntityId) return false;
    if (!e.spatial) return false;
    return this.isSpatialMatch(anchor.spatial!, e.spatial!, ref);
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.id;
  if (ref.sizeRelation) {
    const sizeFiltered = matches.filter((e) =>
      this.matchesSizeRelation(anchor, e, ref.sizeRelation!)
    );
    if (sizeFiltered.length > 0) return sizeFiltered[0]!.id;
  }
  return matches[0]!.id;
}

private isSpatialMatch(anchor: any, target: any, ref: SpatialReference): boolean {
  if (!ref.direction) return true;
  switch (ref.direction) {
    case 'below':    return target.y > anchor.y + anchor.height;
    case 'above':    return target.y + target.height < anchor.y;
    case 'left':     return target.x + target.width < anchor.x;
    case 'right':    return target.x > anchor.x + anchor.width;
    case 'next_to':  return Math.abs(target.y - anchor.y) < 50;
    case 'inside':
      return target.x >= anchor.x && target.y >= anchor.y &&
             target.x + target.width <= anchor.x + anchor.width &&
             target.y + target.height <= anchor.y + anchor.height;
  }
  return false;
}
```

The spatial resolver is the most interesting one architecturally because it operates on a *different kind of state* than the others. Temporal and conversational resolution work off the history ring — a pure in-memory structure maintained by USIR. Spatial resolution works off the *current snapshot's entity coordinates* — data that comes from the adapter layer (the VS Code or browser Hot tier).

The algorithm is: take an anchor entity (required — spatial references are always *relative to something*), filter `candidates` down to entities that are geometrically in the right direction, then disambiguate further using `sizeRelation` if the direction alone produces multiple matches.

The coordinate model (`anchor.y + anchor.height`, `target.x + target.width`) uses raw pixel values from `SemanticEntity.spatial`. These come from the snapshot engine — for the browser adapter, they're viewport-relative bounding rects from `getBoundingClientRect`; for VS Code, they're editor-relative character positions converted to pixels. The resolver doesn't need to know which; it just needs comparable coordinate spaces, which the adapter contract guarantees.

The `next_to` direction uses a 50-pixel threshold (`Math.abs(target.y - anchor.y) < 50`). That's a hardcoded heuristic. It works on standard web UIs, but it will fail on high-DPI displays that haven't been properly scaled, or in XR environments where spatial coordinates are in 3D world-space rather than 2D viewport space. For XR, the spec notes that the resolver would need to perform a *raycast* against `SpatialVolume` meshes, which is a fundamentally different geometric operation. The current pixel arithmetic is a 2D-only approximation.

### 4. Semantic Resolver: "The Function That Parses JSON"

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

The semantic resolver is the weakest link in the chain, and it knows it. The implementation is three lines: lowercase the description, filter candidates by substring match against `displayName` and `role`, return the first match.

This works if the user says "the parseJSON function" and there is a function whose `displayName` is `parseJSON`. It breaks the moment language diverges from the identifier: "the thing that handles JSON" won't match a function called `deserialize`. "The validator" won't match `JWTAuthMiddleware` even if that's the only thing in the project that does validation.

The `description` field on `SemanticReference` and `SemanticEntity` is the designed hook for embeddings-based similarity search. The protocol is ready for it. The implementation isn't there yet. What's missing is an embedding service integration that would replace the `includes()` check with a vector cosine similarity over pre-embedded entity descriptions — something like:

```typescript
// What the semantic resolver should eventually look like:
private async resolveSemanticWithEmbeddings(
  ref: SemanticReference,
  candidates: SemanticEntity[]
): Promise<string | null> {
  const queryVector = await this.embeddingService.embed(ref.description);
  const ranked = candidates
    .filter((e) => e.embeddingVector != null)
    .map((e) => ({
      id: e.id,
      score: cosineSimilarity(queryVector, e.embeddingVector!),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.id ?? null;
}
```

That implementation doesn't exist yet. The current substring match is a placeholder that's better than nothing but will frustrate users whose vocabulary doesn't mirror their codebase's naming conventions.

---

## FusedIntent: When Memory Meets Modality

`InteractionMemory` doesn't operate in isolation. Its outputs feed into `FusedIntent`, the runtime's canonical input primitive defined in `packages/audio-pipeline/src/fused-intent.ts`:

```typescript
// packages/audio-pipeline/src/fused-intent.ts

export interface FusedIntent {
  /** Raw text instruction (from voice or typed) */
  linguisticInput: string;
  /** What the user is pointing at (mouse, gaze, touch) */
  pointingTarget: PointingTarget | null;
  /** Passive cognitive signals (typing cadence, gaze, etc.) */
  implicitSignals: ImplicitSignals;
  /** When the intent was fused (epoch ms) */
  fusedAt: number;
  /** Which surfaces contributed */
  sources: Array<'voice' | 'text' | 'gaze' | 'mouse' | 'touch' | 'wearable'>;
  speakerId?: string;
  fusionConfidence: number;
}
```

The `PointingTarget` deserves attention:

```typescript
export interface PointingTarget {
  entityId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  confidence: number;
  dwellTimeMs: number;     // How long the user has been hovering
}
```

`dwellTimeMs` is a non-obvious but powerful signal. A cursor that has been sitting on an entity for 3,000ms is almost certainly the user's current focus. A cursor that just swept past something during a scroll is not. The `SpatialReference` resolver benefits enormously from knowing what the user is actively dwelling on — if `pointingTarget.entityId` is available at intent resolution time, the spatial resolver can use it as the anchor automatically, eliminating the need for the LLM to explicitly classify the reference as spatial at all.

Here's how the VS Code extension wires this together (from `adapters/vscode`):

```typescript
// From adapters/vscode — the extension's activation handler

let interactionMemory: InteractionMemory;

// On activation:
interactionMemory = new InteractionMemory('user-1');

// When a voice command arrives, build the FusedIntent:
const fused = buildFusedIntent({
  linguisticInput: transcribedText,         // From Whisper
  pointingTarget: hotSnapshot.activeEntity  // From Hot tier snapshot
    ? {
        entityId: hotSnapshot.activeEntity.id,
        bounds: hotSnapshot.activeEntity.spatial,
        confidence: 0.95,
        dwellTimeMs: cursorDwellMs,
      }
    : null,
  implicitSignals: {
    typingCadence: currentTypingCadence,
    cursorDwellTimeMs: cursorDwellMs,
    editsPerMinute: recentEditRate,
  },
  sources: ['voice', 'mouse'],
  fusionConfidence: whisperConfidence,
});
```

The three signals — linguistic (what they said), pointing (where they're looking), implicit (how they're behaving) — fuse into a single payload that the LLM router receives. The router can then emit a `CognitiveReference` that the `InteractionMemory` resolves using whichever strategy fits: if the pointing target is high-confidence, spatial resolution wins; if it's absent, conversational or temporal resolution takes over.

This is the architecture that makes "open that" work. Not magic — signal fusion and reference resolution, each with a well-defined scope.

---

## Disambiguation: When Memory Is Not Enough

Sometimes the resolver returns multiple candidates. Sometimes it returns none. The runtime's answer to both situations is `InteractionWaypoint`, built by `packages/runtime/src/disambiguation/collaborative-narrowing.ts`.

```typescript
// packages/runtime/src/disambiguation/collaborative-narrowing.ts

const PHONETIC_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', /* … 'Zulu' */];

export function buildDisambiguationWaypoint(args: {
  waypointId: string;
  rawInstruction: string;
  candidates: SemanticEntity[];
  contextHint?: string;
}): InteractionWaypoint {
  const { waypointId, rawInstruction, candidates, contextHint } = args;
  const phonetic = assignPhoneticNames(candidates);

  const options = candidates.map((e) => ({
    id: e.id,
    label: `${phonetic.get(e.id)} — ${e.displayName}`,
    description: e.context ? JSON.stringify(e.context) : undefined,
  }));

  const tts = `I found ${candidates.length} matches for "${rawInstruction}". ${
    candidates.map((e) => `${phonetic.get(e.id)}: ${e.displayName}`).join('; ')
  }. Which one?`;

  return {
    id: waypointId,
    context: { state: 'disambiguation', objective: `Resolve: ${rawInstruction}` },
    presentations: {
      display: { layout: 'wizard_list', prompt: contextHint ?? `"${rawInstruction}"`, options },
      audio: { tts, choices: options.map((o) => o.label) },
    },
  };
}
```

The phonetic NATO alphabet assignment is deliberate and smart. Voice interfaces need candidates with names that are: (a) unambiguous when spoken (`Alpha` vs `Bravo` vs `Charlie` are phonetically distinct), (b) short, and (c) stable within a session (same entity always gets the same name, so "Alpha" in turn 3 refers to the same thing as "Alpha" in turn 7).

The `InteractionWaypoint` structure carries the same disambiguation as three different renderings simultaneously:

```
display  →  VS Code quick-pick or HTML disambiguation panel
audio    →  TTS prompt read aloud ("I found 3 matches... Alpha: parseJSON, Bravo: deserialize...")
```

The surface adapter picks the rendering appropriate to its modality. On a screen, a quick-pick list. In a pure voice context, a TTS prompt and spoken response. The runtime sends one object; the adapter decides how to render it. Same disambiguation data, three renderers.

There's also a lightweight confirmation path for high-confidence single candidates. Instead of a full disambiguation waypoint, the runtime can emit a "confirm?" prompt:

> *"Did you mean `JWTAuthMiddleware.validate`?"*

User says "yes" — command executes. User says "no" — full disambiguation opens. This reduces friction for the 80% case where the resolver's top candidate is right, without dropping the safety net.

**Every disambiguation choice becomes a memory entry.** When the user picks "Alpha," the runtime calls `pushToHistory('entity-id-of-alpha')`. If they follow up with "rename it," the conversational resolver will return Alpha's entity ID. The disambiguation wasn't just UX — it was memory construction.

---

## The Session Boundary and the SQLite Path

The most significant architectural limitation of the current `InteractionMemory` is the session boundary. When the VS Code extension unloads, the `InteractionMemory` instance is garbage-collected. The next time you open VS Code and say "open the file I was editing earlier," the runtime has no idea what "earlier" means.

The persistence infrastructure is in place to fix this. `SqliteStorage` provides a drop-in replacement for `JsonFileStorage`:

```typescript
// packages/runtime/src/sqlite-storage.ts

export class SqliteStorage implements Storage {
  private db: SqliteDb | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ':memory:';
  }

  save<T>(path: string, data: T): void {
    const db = this.getDb();
    const value = JSON.stringify(data);
    db.prepare('INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)')
      .run(path, value);
  }

  load<T>(path: string): T | null {
    const db = this.getDb();
    const row = db.prepare('SELECT value FROM storage WHERE key = ?')
      .get(path) as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as T;
  }
}
```

`SqliteStorage` is opt-in — you install `better-sqlite3` (`pnpm add better-sqlite3`) and pass a `SqliteStorage` instance to the `InteractionMemory` constructor:

```typescript
const memory = new InteractionMemory(
  'user-1',
  new SqliteStorage(path.join(os.homedir(), '.usir', 'memory.db'))
);
```

The `Persistable<InteractionMemoryData>` interface then gives you `save(path)` and `load(path)` — enough to checkpoint memory on session end and restore it on session start:

```typescript
// On activation (extension host startup):
memory.load('~/.usir/memory.db');

// On deactivation:
memory.save('~/.usir/memory.db');
```

The schema is flat: one SQLite table, key-value with JSON values. It won't win awards for query performance against a 10,000-turn history, but it's correct, portable, and zero-dependency (beyond `better-sqlite3`). For the current use case — a ring buffer of 50 entities plus a conversation log — it's more than adequate.

What would make cross-session memory genuinely powerful isn't the storage backend — it's the temporal resolver. Once the history ring is timestamped per-event (not just per-session), "the file I edited last week" becomes a real query: walk the persisted `ConversationTurn` history backward, filter by `eventType === 'edited'`, find the first entry older than 7 days. The data structure is ready. The query logic isn't written yet.

---

## The Memory Snapshot: What the Router Sees

The LLM router doesn't get raw `InteractionMemory` access. It gets a `InteractionMemorySnapshot` — a serializable, immutable view of the current memory state:

```typescript
// From packages/protocol/src/memory/index.ts

export interface InteractionMemorySnapshot {
  recentEntityIds: string[];         // The history ring, most-recent-first
  lastDiscussedEntityId: string | null;  // The current "it"
  conversationHistory: ConversationTurn[];
  sessionStartedAt: number;
  userId: string;
}
```

This snapshot is included in the system prompt passed to the LLM router. The router uses it to classify what *kind* of `CognitiveReference` the user's command contains — temporal, conversational, spatial, or semantic — and to emit the right reference type. The actual resolution happens in `InteractionMemory.resolve()`, not in the LLM.

This separation is important for two reasons. First, it keeps resolution deterministic. String fuzzy-matching is predictable in a way that asking an LLM "which file did they mean?" is not. Second, it keeps the context window lean. The router doesn't need the full entity graph — it needs enough signal to classify the reference type. The snapshot provides exactly that.

---

## Architecture Summary

```
User utterance: "rename that function to validateToken"
         │
         ▼
   Whisper STT → linguisticInput: "rename that function to validateToken"
         │
         ▼
   buildFusedIntent()
    ├── linguisticInput: "rename that function to validateToken"
    ├── pointingTarget:  { entityId: "fn-parseJWT", confidence: 0.97, dwellTimeMs: 2300 }
    └── implicitSignals: { typingCadence: "halted", cursorDwellTimeMs: 2300 }
         │
         ▼
   LLM Router (receives FusedIntent + InteractionMemorySnapshot)
    └── emits: intent.manipulation.edit {
          target: { kind: 'spatial', anchorEntityId: 'fn-parseJWT', direction: 'none' }
          // or simply: { kind: 'conversational', position: 'most_recent' }
          // because pointing target already anchors to fn-parseJWT
        }
         │
         ▼
   InteractionMemory.resolve(reference, candidateEntities)
    └── returns: "fn-parseJWT"   ← resolved entity ID
         │
         ▼
   TopologicalExecutor
    └── runs rename tool on entity "fn-parseJWT"
         │
         ▼
   pushToHistory("fn-parseJWT", { rawInput: "rename that function...", intentId: "..." })
    └── "fn-parseJWT" is now history[0], lastDiscussed
```

The memory system is not a loop — it's a pipeline with a feedback arc. Every resolved command updates the memory. Future commands resolve against the updated state. Over the course of a session, the runtime builds a working model of what the user has been touching, expressed as a simple but well-structured ring buffer.

---

## Critical Take: What's Working, What Isn't

**What works well:**

The conversational resolver is production-ready. "The previous one," "go back," "that function" — anything that maps to a history position — resolves correctly and efficiently. For the day-to-day development workflow, this covers the majority of ambiguous references.

The spatial resolver is solid for 2D viewport contexts. The coordinate arithmetic is correct, the anchor+direction model covers the natural language geography of a typical screen, and the sizeRelation fallback handles the common "the bigger one" disambiguation gracefully.

The `FusedIntent` architecture is genuinely excellent. Combining linguistic, pointing, and implicit signals into a single payload — and having the resolver use all three — is the right design. Most voice interfaces receive only the linguistic signal and wonder why reference resolution is hard.

The disambiguation waypoint system is elegant. Phonetic names, multi-modal rendering, and the insight that every disambiguation is a memory update — these are all right.

**What needs work:**

The semantic resolver is the weakest link. Substring matching against `displayName` and `role` will fail on any codebase with opaque naming conventions, which is most real codebases. The embeddings hook is designed but not implemented. Until it is, users who say "the authentication middleware" to a project that has a class called `RequestGuard` will be stuck.

The temporal resolver is an architectural placeholder. The infrastructure for event-typed timestamps exists in `ConversationTurn`, but the resolver doesn't use it. "The file I edited yesterday" resolves to the same entity as "that one." This is the most common failure mode for voice interfaces that claim to have memory — they track presence but not time.

The 50-entity history limit (`HISTORY_LIMIT = 50`) is a reasonable default but isn't configurable. A user working across a large monorepo who opens 50+ files in a session will silently lose early context. There's no eviction policy beyond FIFO — no LRU weighting, no recency scoring. The ring buffer is correct but minimal.

The SQLite backend is opt-in and undocumented in the user-facing VS Code extension. Cross-session memory — arguably the feature that would make "the file I was working on last week" possible — requires manual setup that most users will never discover. The path to making this default is clear (detect `better-sqlite3`, initialize the database in the extension's global storage path), but it hasn't been walked yet.

**The honest summary:** `InteractionMemory` solves the hard part of the problem — the architecture — and leaves the easy part of the problem (embeddings, temporal indexing, automatic persistence) as implementation debt. That's a reasonable trade for a pre-alpha, but the debt is load-bearing. A voice interface without reliable semantic and temporal resolution is a voice interface users will stop trusting after the third wrong guess.

---

## What's Next

[Part 7 — The LLM Router and Topological Executor](#) takes the resolved intent output of `InteractionMemory` and follows it into the execution pipeline: how the LLM router converts an intent into a JSON DAG, and how the `TopologicalExecutor` runs that DAG with parallelism, retry logic, and rollback. Memory told us *what* the user meant. The executor will tell us *how* to do it safely.

---

*This post is part of the **Decoding the Post-GUI Runtime** series — a 14-part technical deep-dive into the Universal Semantic Interaction Runtime. All code excerpts are from the USIR repository as of its current pre-alpha state.*
