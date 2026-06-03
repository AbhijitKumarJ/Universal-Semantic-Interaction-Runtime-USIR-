# Part 4: The Tiered Snapshot Engine — 16ms Is Not an Accident

> *Act I — The Foundation | Part 4 of 14*
>
> **Previously:** [Part 3](./usir-part3-semantic-entities.md) built the data model: `SemanticEntity` as the atomic unit, `SemanticGraph` as the typed relational container. We saw how the browser DOM adapter extracts entities via `TreeWalker`, and how the VS Code adapter builds them from LSP events. Now: how does all that state get organized, timestamped, and delivered to the runtime under latency budgets that range from 16 milliseconds to several seconds?

---

There is a fundamental tension at the heart of every AI-augmented interface. AI inference is slow — even a local model call takes tens to hundreds of milliseconds. User input is instantaneous — a cursor move, a selection change, a spoken word. If the system waits for the AI before acknowledging the user's action, it feels broken. If the AI acts on stale state, it makes mistakes.

USIR's answer to this tension is the **Tiered Snapshot Engine**: a three-layer architecture that separates *what is happening right now* (Hot, ≤16ms) from *what is visible on screen* (Warm, ≤150ms) from *the full semantic context of the project* (Cold, async). Each tier has a hard latency budget encoded in the type system itself. The runtime never waits for a slower tier before serving a faster one.

This post traces that architecture from the protocol types in `packages/protocol/src/snapshot/index.ts` all the way to the VS Code event wiring in `apps/vscode-extension/src/extension.ts`. Along the way, we'll confront why "16ms in the browser" and "16ms in the VS Code extension host" are very different engineering problems — and how the webview audio bridge is a direct consequence of that difference.

---

## The Protocol Layer: Tiers as Types

The snapshot architecture starts as a TypeScript contract. Before a single byte of adapter code exists, `packages/protocol/src/snapshot/index.ts` declares what every adapter must produce:

```typescript
/**
 * The tiered structure (Hot/Warm/Cold) is the critical engineering insight:
 * it lets the runtime serve a sub-16ms Hot Tier for cursor/selection state
 * while still having full LSP/workspace context available asynchronously.
 */
```

The comment is the design document. Now the types:

### `HotSnapshot` — the invocation anchor

```typescript
export interface HotSnapshot {
  tier: 'hot';
  activeRegion: string;
  activeEntity: SemanticEntity;
  selections: SemanticEntity[];
  pointerTarget?: { entityId: string; bounds: SpatialBounds };
  ephemeral: Array<{ entityId: string; kind: 'select' | 'edit' | 'open' | 'close'; at: number }>;
  capturedAt: number;
  latencyBudgetMs: 16;  // <-- literal type
}
```

Three things to notice:

`latencyBudgetMs: 16` is a **literal type**, not a number. TypeScript enforces at compile time that this field can only hold the value `16`. This is not defensive coding — it is documentation that cannot drift out of sync with implementation. When you see a `HotSnapshot` in any part of the codebase, you know it was produced under a 16ms budget. There is no runtime assertion required; the type system carries the contract.

`activeEntity` is non-optional. A `HotSnapshot` always has an active entity. This is a strong invariant: the runtime can always ask "what is the user working on right now?" and get a definite answer. The browser adapter's fallback is a synthetic `dom://viewport` entity; the VS Code adapter's fallback is the entity passed to `SnapshotEngine`'s constructor. Neither ever returns `null`.

`ephemeral` is a ring buffer of recent micro-events — the last few "select", "edit", "open", "close" events with timestamps. This is the Hot tier's contribution to the `CognitiveReference` resolver: when the user says "the thing I just opened", the resolver reads `hot.ephemeral` for the most recent `'open'` event and resolves the entity id. The ring buffer is bounded to 50 entries in both adapters — old enough to cover a brief pause before speaking, small enough to never become a memory concern.

### `WarmSnapshot` — the visible context

```typescript
export interface WarmSnapshot {
  tier: 'warm';
  visible: SemanticEntity[];
  recentlyChanged: Array<{ entity: SemanticEntity; delta: Record<string, unknown> }>;
  panelLayout: Array<{ panelId: string; kind: string; bounds: SpatialBounds }>;
  capturedAt: number;
  latencyBudgetMs: 150;
}
```

`visible` is the entities currently rendered on screen — the subset of the full semantic graph that is actually in view. For the browser adapter, this is the output of `buildViewportEntities` (the `TreeWalker`-filtered list from Part 3). For the VS Code adapter, it is the set of currently open files and panels.

`recentlyChanged` carries entities that changed in the last few seconds along with a `delta` — a free-form record of what changed. When `onDidChangeTextDocument` fires in VS Code, the warm tier records the changed entity with `{ version: e.document.version }` as the delta. The LLM router uses this to answer questions like "what did I just edit?" or to bias `locate` intents toward recently modified files.

`panelLayout` is the structural layout of the interface — which panels exist, what kind they are, and where they sit spatially. This is what enables spatial references like "the panel on the right" or "the bottom terminal." The VS Code adapter populates this from the editor group layout; the browser adapter leaves it empty (the DOM doesn't have a clean panel abstraction). This asymmetry between adapters is fine — the protocol has the field, adapters fill it when they can.

### `ColdSnapshot` — the full graph

```typescript
export interface ColdSnapshot {
  tier: 'cold';
  graph: SemanticGraph;
  lspMetadata: Record<string, LspEntityMetadata>;
  capturedAt: number;
  latencyBudgetMs: number;  // <-- not a literal; can be seconds
}
```

Note the contrast: `ColdSnapshot.latencyBudgetMs` is a plain `number`, not a literal. There is no hard latency promise for cold. It arrives when it arrives — typically within a second or two in VS Code (LSP indexing time), potentially longer on first activation when the language server is warming up.

`lspMetadata` is the IDE-specific enrichment layer: type signatures, documentation strings, diagnostic errors, definition locations, reference sites. This is what allows the LLM router to construct a prompt like: *"The function `authenticateUser` has type `(token: string) => Promise<User>`. It is referenced in 3 other files. There are 0 diagnostics."* That context lives in `lspMetadata`, indexed by entity id, alongside the generic `SemanticGraph`.

### `SemanticSnapshot` — the assembled whole

```typescript
export interface SemanticSnapshot {
  hot: HotSnapshot;
  warm: WarmSnapshot;
  cold?: ColdSnapshot;  // <-- optional
  source: string;
  version: number;
  assembledAt: number;
}
```

The critical design decision is `cold?: ColdSnapshot` — cold is optional. The runtime never requires cold before acting. `assembledAt` is distinct from `hot.capturedAt`: `assembledAt` is when the three tiers were combined into one object, which may be long after the hot tier was captured. The `version` field tracks mutations across all three tiers, inherited from `SemanticGraph.version` (see Part 3).

---

## The VS Code Adapter: Tiers as Classes

The protocol defines the shape. The adapter implements the behavior. `adapters/vscode/src/snapshot/` contains four files: one class per tier, plus the engine that orchestrates them.

### `HotTier` — 16ms debounce

```typescript
export class HotTier {
  public activeEntity: SemanticEntity;
  public activeRegion: string = 'editor';
  public selections: SemanticEntity[] = [];
  public pointerTarget: { entityId: string; bounds: { ... } } | null = null;
  public ephemeral: Array<{ entityId: string; kind: ...; at: number }> = [];

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(activeEntity: SemanticEntity, onUpdate: () => void) {
    this.activeEntity = activeEntity;
    this.onUpdate = onUpdate;
  }

  public updateActiveEntity(entity: SemanticEntity, region: string = 'editor'): void {
    this.activeEntity = entity;
    this.activeRegion = region;
    this.recordEphemeral(entity.id, 'open');
    this.scheduleUpdate();
  }

  public toSnapshot(): HotSnapshot {
    return createEmptyHotSnapshot(this.activeEntity, this.activeRegion);
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 16);
  }
}
```

The debounce period is `16` — exactly the Hot tier's latency budget. This is deliberate: the `onUpdate` callback (which bumps the engine's `version`) fires at most once per animation frame. If the user moves the cursor 10 times within a single 16ms window, `scheduleUpdate` clears and resets the timer 10 times, and `onUpdate` fires once. The resulting snapshot reflects the *final* cursor position, not every intermediate step.

The ephemeral ring buffer is capped at 50 entries with a `shift()` on overflow — an O(1) push and a (at worst) O(n) shift. For 50 entries this is fine; for a larger cap it would need a proper ring buffer with a head pointer. At 50 entries the simplicity is worth it.

Notice what `toSnapshot()` does *not* include: `pointerTarget` and `selections` are stored on the class but the current `createEmptyHotSnapshot` implementation does not serialize them into the snapshot. This is an incomplete implementation — `pointerTarget` in particular is important for `FusedIntent` (see Part 9), and the gap between stored state and serialized state is a real bug surface. The `extension.ts` code reads `snapshotEngine.hot.pointerTarget` *directly* (bypassing `toSnapshot()`) when building the `FusedIntent` before routing.

### `WarmTier` — 150ms debounce

```typescript
export class WarmTier {
  public visible: Map<string, SemanticEntity> = new Map();
  public recentlyChanged: Array<{ entity: SemanticEntity; delta: ... }> = [];
  public panelLayout: Array<{ panelId: string; kind: string; bounds: SpatialBounds }> = [];

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 150);
  }

  public toSnapshot(): WarmSnapshot {
    return {
      tier: 'warm',
      visible: Array.from(this.visible.values()),
      recentlyChanged: this.recentlyChanged.slice(-20),
      panelLayout: this.panelLayout,
      capturedAt: Date.now(),
      latencyBudgetMs: 150,
    };
  }
}
```

`visible` is a `Map<string, SemanticEntity>` rather than an array for a practical reason: `setVisible` calls `this.visible.clear()` followed by repeated `this.visible.set(e.id, e)`. If the caller passes the same entity twice (e.g., due to a re-render), the Map deduplicates automatically. An array would silently accumulate duplicates that would confuse the LLM router.

`toSnapshot()` slices `recentlyChanged` to the last 20 entries. The internal buffer holds up to 100, but only the 20 most recent are serialized into the snapshot. This keeps the snapshot small for over-the-wire transmission while the full history remains available for other consumers (e.g., the provenance store, the interaction memory).

The `panelLayout` field is populated but not debounced separately — it updates on the 150ms cycle. Panel layout changes are rare (user resizes a split, opens a terminal) and don't require the same granularity as cursor position.

### `ColdTier` — 1 second debounce

We covered `ColdTier` in Part 3 in the context of graph operations. The key addition here is the timing: `scheduleUpdate` uses a 1-second debounce.

```typescript
private scheduleUpdate(): void {
  if (this.updateScheduled) return;
  this.updateScheduled = true;
  setTimeout(() => {
    this.updateScheduled = false;
    this.onUpdate();
  }, 1000);
}
```

One second is the LSP's minimum useful update cycle — it takes roughly that long after a keystroke for TypeScript's language server to re-check types and update diagnostics. Debouncing at 1s means the cold tier's `onUpdate` never fires more than once per second, regardless of how many `addEntity` calls arrive during active editing. This is the correct design for a background indexing tier.

There's a subtlety: `updateScheduled` is a boolean flag rather than a stored timer handle. Unlike the Hot and Warm debounces (which reset the timer on each call, keeping the deadline sliding), Cold's debounce fires exactly once after the first mutation and then re-arms. The consequence is that rapid edits in the first second after activation will produce a cold update 1 second later, then go quiet until the next edit. This is the right behavior for LSP-backed data.

### `SnapshotEngine` — the orchestrator

```typescript
export class SnapshotEngine {
  private version: number = 0;
  public hot: HotTier;
  public warm: WarmTier;
  public cold: ColdTier;

  constructor(initialActiveEntity: SemanticEntity) {
    this.hot = new HotTier(initialActiveEntity, () => this.bumpVersion());
    this.warm = new WarmTier(() => this.bumpVersion());
    this.cold = new ColdTier(() => this.bumpVersion());
  }

  public assemble(includeCold: boolean = false): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: this.warm.toSnapshot(),
      cold: includeCold ? this.cold.toSnapshot() : undefined,
      source: 'vscode',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  public hotOnly(): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: { tier: 'warm', visible: [], recentlyChanged: [], panelLayout: [], capturedAt: Date.now(), latencyBudgetMs: 150 },
      cold: undefined,
      source: 'vscode',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  private bumpVersion(): void {
    this.version++;
    this.lastAssembledAt = Date.now();
  }
}
```

Every tier calls `bumpVersion` when it updates. This means `SemanticSnapshot.version` increments on any tier change — a hot-tier cursor move, a warm-tier file open, a cold-tier LSP update all increment the same counter. The LLM router can cache snapshots by version and skip re-processing when the version hasn't changed.

`hotOnly()` is the fast path. When audio capture produces a transcribed utterance and the runtime needs to immediately build a `FusedIntent`, it calls `hotOnly()` to get the invocation anchor without waiting for warm or cold assembly. This is why the Hot tier must be perpetually fresh: it is the only tier that is always included, always current, and always the first thing the LLM sees.

The `assemble(false)` call in `handleInstruction` (the main voice-command handler in `extension.ts`) includes warm but not cold. This is the "second-wave" pattern: hot for immediate context, warm for visible entities, cold only when the LLM needs deep dependency analysis. The cold tier is fetched lazily, after the first routing pass has already started.

---

## Event Wiring: VS Code → Snapshot Engine

The snapshot engine is inert until VS Code events drive it. `extension.ts` contains the wiring:

```typescript
context.subscriptions.push(
  // HOT: cursor moved or file focused
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      const entity = createEntity({ id: editor.document.uri.toString(), role: 'source_file', ... });
      snapshotEngine.hot.updateActiveEntity(entity);
      interactionMemory.pushToHistory(entity.id);
    }
  }),

  // HOT: selection changed (cursor moved within file)
  vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor === vscode.window.activeTextEditor) {
      const entity = createEntity({ id: e.textEditor.document.uri.toString(), ... });
      snapshotEngine.hot.updateSelection([entity]);

      const pos = e.selections[0]?.active;
      if (pos) {
        snapshotEngine.hot.updatePointerTarget({
          entityId: entity.id,
          bounds: { x: pos.character, y: pos.line, width: 1, height: 1 },
        });
      }
    }
  }),

  // WARM + COLD: document edited
  vscode.workspace.onDidChangeTextDocument((e) => {
    const entity = createEntity({ id: e.document.uri.toString(), ... });
    snapshotEngine.cold.addEntity(entity);         // cold: update graph
    snapshotEngine.warm.recordChange(entity, { version: e.document.version }); // warm: record delta
  }),

  // COLD: new file opened (workspace graph grows)
  vscode.workspace.onDidOpenTextDocument((doc) => {
    const entity = createEntity({ id: doc.uri.toString(), role: 'source_file', ... });
    snapshotEngine.cold.addEntity(entity);
  }),
);
```

The event-to-tier mapping is the architectural principle made concrete:

- `onDidChangeActiveTextEditor` and `onDidChangeTextEditorSelection` → **Hot tier** only. These are cursor/focus events that the user experiences as instantaneous. The 16ms debounce absorbs rapid selection changes.
- `onDidChangeTextDocument` → **Both Warm and Cold**. A document edit is visible context (warm: what changed recently) and a graph mutation (cold: the file entity is updated in the semantic graph).
- `onDidOpenTextDocument` → **Cold only**. Opening a new file adds it to the semantic graph, but doesn't change what's immediately visible — that happens only when the editor tab becomes active (which fires `onDidChangeActiveTextEditor`).

One event is conspicuously absent: `vscode.workspace.onDidChangeWorkspaceFolders`. When the user adds or removes a workspace root, the cold graph should be rebuilt. This is not wired in the current implementation, which means the cold graph can become stale when workspace folders change without a full extension restart.

---

## The Browser Adapter: Same Shape, Different World

The browser adapter (`adapters/browser/src/`) mirrors the VS Code adapter's structure — `BrowserHotTier`, `BrowserWarmTier`, `BrowserColdTier`, `BrowserSnapshotEngine` — but the event sources are DOM events rather than VS Code API events.

The `BrowserHotTier` tracks a slightly different set of events than its VS Code counterpart:

```typescript
export class BrowserHotTier {
  public ephemeral: Array<{
    entityId: string;
    kind: 'click' | 'hover' | 'scroll' | 'focus' | 'input';
    at: number
  }> = [];

  public updatePointer(x: number, y: number, entityId: string | null): void { ... }
  public updateScroll(x: number, y: number): void { ... }
  public recordInteraction(entityId: string, kind: 'click' | 'hover' | 'scroll' | 'focus' | 'input'): void { ... }
}
```

The ephemeral event vocabulary expands from VS Code's `'select' | 'edit' | 'open' | 'close'` to browser-appropriate `'click' | 'hover' | 'scroll' | 'focus' | 'input'`. This is the protocol's tolerance for adapter-specific extension: the core `HotSnapshot.ephemeral` type uses `'select' | 'edit' | 'open' | 'close'` (the VS Code vocabulary), but the browser adapter's internal model tracks `'click'` and `'scroll'` events before mapping them to the common type at `toSnapshot()` time.

The same 16ms debounce:

```typescript
private scheduleUpdate(): void {
  if (this.debounceTimer) clearTimeout(this.debounceTimer);
  this.debounceTimer = setTimeout(() => this.onUpdate(), 16);
}
```

In the browser, `setTimeout(..., 16)` fires at the next animation frame opportunity. This is a real `requestAnimationFrame`-equivalent timing on main-thread browsers, with the caveat that background tabs can throttle `setTimeout` to 1000ms or more. USIR's voice-command scenario assumes the browser tab is active (the user is talking to it), so background throttling is not a practical concern.

---

## The Architecture Diagram

```
VS Code Extension Host (Node.js thread)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  VS Code Events                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  onDidChangeActiveTextEditor ──────────────────► HotTier        │
│  onDidChangeTextEditorSelection ───────────────► HotTier        │
│  onDidChangeWindowState ───────────────────────► HotTier        │
│  onDidChangeTextDocument ──────────────────────► WarmTier       │
│                                     └──────────► ColdTier       │
│  onDidOpenTextDocument ────────────────────────► ColdTier       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SnapshotEngine                                          │   │
│  │                                                          │   │
│  │  HotTier   (debounce: 16ms)   ─► HotSnapshot            │   │
│  │  WarmTier  (debounce: 150ms)  ─► WarmSnapshot           │   │
│  │  ColdTier  (debounce: 1000ms) ─► ColdSnapshot?          │   │
│  │                                                          │   │
│  │  assemble(false) → { hot, warm, cold: undefined }       │   │
│  │  hotOnly()       → { hot, warm: empty, cold: undefined } │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│  [extension cannot call   │   The runtime calls assemble()       │
│   Web Audio API directly] │   here, in the same Node.js thread   │
│                           ▼                                      │
│                     SemanticSnapshot ──────► LLMRouter           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WebviewAudioCapture (hidden WebviewPanel)                 │ │
│  │                                                            │ │
│  │  [Browser context: Web Audio API available]               │ │
│  │  navigator.mediaDevices.getUserMedia()                    │ │
│  │  AudioContext + AnalyserNode (16kHz, mono)                │ │
│  │  VAD → utterance boundary detection                       │ │
│  │  PCM chunk → vscode.postMessage({ type: 'pcm', data })   │ │
│  │                          │                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                             │  postMessage IPC                   │
│             ┌───────────────┘                                    │
│             ▼                                                    │
│  onDidReceiveMessage({ type: 'pcm', data: Uint8Array })         │
│  → whisperClient.transcribe(buffer)                             │
│  → handleInstruction(text)                                      │
│  → snapshotEngine.assemble(false)                               │
│  → llmRouter.route(...)                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## The Critical Take: 16ms in the Extension Host Is a Lie

The 16ms Hot tier budget is achievable in the browser. It is a polite fiction in the VS Code extension host.

Here is the problem. The VS Code extension host is a dedicated Node.js process. It runs JavaScript, just like the browser, but with critical differences:

**No `requestAnimationFrame`.** The 16ms budget in a browser is meaningful because it maps directly to one display frame at 60fps — the rendering engine's natural rhythm. `setTimeout(fn, 16)` in a browser fires near a frame boundary and is accurate to a few milliseconds. In a Node.js process, `setTimeout(fn, 16)` is a best-effort timer with no display-frame alignment. Under CPU load (TypeScript type-checking, file indexing, npm scripts), timers can drift to 30ms, 50ms, or worse.

**Extension host is not isolated.** Other extensions share the same process. A heavy extension doing workspace analysis can starve the event loop and delay USIR's timer callbacks. The VS Code team has been gradually moving expensive extensions to a separate "extension host worker" process, but USIR is not yet there.

**The `toSnapshot()` gap.** `HotTier.toSnapshot()` calls `createEmptyHotSnapshot(this.activeEntity, this.activeRegion)`. This function ignores `this.selections` and `this.pointerTarget`. So even if the Hot tier updates within 16ms, the snapshot it produces is incomplete — it carries `activeEntity` but not `selections` or `pointerTarget`. The `handleInstruction` function works around this by reading `snapshotEngine.hot.pointerTarget` directly before calling `assemble()`. This bypass is correct as a workaround but means the `HotSnapshot` type's promise (that it contains all hot-tier state) is not fully delivered by the current implementation.

### Why the WebviewAudioCapture exists

The most telling consequence of the extension host's limitations is the audio capture architecture. VS Code extensions running in the extension host cannot call `navigator.mediaDevices.getUserMedia()` — that's a browser API. The extension host is a Node.js process with no Web Audio access.

The original design presumably assumed USIR could use a native audio library (e.g., `node-microphone`, `portaudio` bindings) from Node.js. The problem is that native Node.js modules require platform-specific binaries, which are notoriously fragile across operating systems, VS Code versions, and Electron updates. This is the `N-API` trap — native extensions in VS Code extensions have a history of breaking on every Electron upgrade.

The solution USIR chose is architecturally clever: create a hidden VS Code WebviewPanel and run all audio capture in the webview's browser context, where `getUserMedia` and the Web Audio API work normally. The webview posts PCM chunks back to the extension host via `vscode.postMessage`.

```typescript
// In the webview (browser context):
var pcm = floatTo16BitPCM(concatenated);
vscode.postMessage({ type: 'pcm', data: new Uint8Array(pcm.buffer) });

// In the extension host (Node.js):
this.panel.webview.onDidReceiveMessage(async (message) => {
  if (message.type === 'pcm') {
    const buffer = Buffer.from(message.data.buffer, ...);
    const text = await this.config.stt.transcribe(buffer, { ... });
    this.config.onUtterance(text.trim());
  }
});
```

The VAD (Voice Activity Detection) runs in the webview, producing complete utterance chunks rather than a raw PCM stream. This is important: `postMessage` has non-trivial overhead for large binary payloads. Sending 16kHz mono PCM as 128-byte frames (8ms each) would mean one `postMessage` call every 8ms — hundreds per second, with serialization overhead on each. By detecting utterance boundaries in the webview and sending complete utterance chunks (typically 1-5 seconds of audio), the IPC is reduced to a handful of calls per minute.

The webview VAD implementation is a simple energy-threshold detector:

```typescript
var VAD_CONFIG = {
  energyThreshold: 0.01,
  silenceDurationMs: 800,
  minSpeechMs: 300,
};

function processVAD(samples) {
  var rms = computeRMS(samples);
  var isSpeech = rms > VAD_CONFIG.energyThreshold;
  // ... state machine: idle → listening → silence → emit utterance
}
```

This is a first-order VAD — RMS energy threshold with a silence duration gate. It will misfire on background noise, truncate soft speech, and false-trigger on loud non-speech sounds. A production VAD uses spectral features, a trained classifier, and speaker-adaptive thresholds. USIR's VAD is correct for a pre-alpha where the user is in a quiet room with a decent microphone. It is not correct for open-plan offices.

The deeper consequence of the webview bridge: the Hot tier and the audio pipeline are in different execution contexts. When the user finishes speaking, the following happens:

1. Webview detects utterance boundary, serializes PCM to `Uint8Array`
2. `vscode.postMessage` crosses IPC from browser process to Node.js extension host
3. Extension host receives the message, deserializes `Uint8Array` to `Buffer`
4. Whisper transcribes the audio (network call to Groq or local binary invocation)
5. Extension host reads `snapshotEngine.hot.pointerTarget` for the current cursor position

Step 5 reads the Hot tier, but that state was last updated before step 1 — before the utterance even started. If the user spoke while moving their cursor, the cursor position in step 5 is the cursor position at utterance start, not utterance end. In most voice-command scenarios this is fine (users tend to land the cursor where they want, then speak). In rapid voice-cursor workflows it could be a source of wrong-entity attribution.

This is not a bug in USIR's design — it is an inherent consequence of the asynchronous boundary between audio capture and state reading. A fully correct solution would timestamp the utterance start and end in the webview, then replay the hot tier's event log to find the cursor position at the utterance start. The `HotSnapshot.ephemeral` ring buffer exists for exactly this purpose — but the current `handleInstruction` implementation does not use it for this.

---

## Snapshot Assembly in the Voice-Command Path

The full flow, once audio is transcribed, is visible in `extension.ts`:

```typescript
async function handleInstruction(rawInstruction: string) {
  // 1. Build FusedIntent: voice text + current pointer target + implicit signals
  const pointingTarget = snapshotEngine.hot.pointerTarget
    ? { entityId: ..., bounds: ..., confidence: 1.0, dwellTimeMs: 0 }
    : null;
  const fused = buildFusedIntent({
    linguisticInput: rawInstruction,
    pointingTarget,
    implicitSignals: { cursorDwellTimeMs: 0, typingCadence: 'idle' },
    sources: ['voice', 'mouse'],
  });

  // 2. Push to interaction memory
  if (fused.pointingTarget) {
    interactionMemory.pushToHistory(fused.pointingTarget.entityId, { rawInput: rawInstruction });
  }

  // 3. Assemble snapshot: hot + warm, no cold
  const snapshot = snapshotEngine.assemble(false);

  // 4. Route: snapshot + memory → intent plan
  const plan = await llmRouter.route({ rawInstruction, snapshot, memory: interactionMemory.snapshot() });

  // 5. Handle ambiguities or execute
  ...
}
```

`snapshotEngine.assemble(false)` — `false` meaning no cold. The LLM router gets:
- `hot`: current active entity, selections, cursor position (≤16ms stale)
- `warm`: all visible entities, recently changed files (≤150ms stale)
- `cold`: `undefined`

The cold tier is available (`snapshotEngine.cold.exportGraph()` is used elsewhere to feed `getAvailableEntityIds` to the LLM router's tool registry), but it is not assembled into the over-the-wire snapshot. This is a deliberate first-pass strategy: serve the intent with the freshest available context, and only reach for the cold graph if disambiguation fails or the intent requires deep dependency analysis.

The LLM router's call to `getAvailableEntityIds` — which does query the cold graph — is the second wave. This two-wave architecture (fast hot+warm snapshot → slow cold entity list) is how USIR avoids the cold-start latency problem for common intents. "Navigate to main.ts" doesn't need the full cold graph — the file entity is likely in the warm tier's `visible` list or in `interactionMemory`. Only complex intents like "find all callers of this function" genuinely require the cold graph's BFS traversal.

---

## Browser vs VS Code: A Structural Comparison

| Property | VS Code Adapter | Browser Adapter |
|---|---|---|
| Hot tier events | `onDidChangeTextEditorSelection`, `onDidChangeActiveTextEditor` | DOM `mousemove`, `click`, `focus`, `input` |
| Warm tier events | `onDidChangeTextDocument` | DOM `MutationObserver`, scroll |
| Cold tier data | LSP symbols, diagnostics, file graph | `buildDomGraph` output |
| Panel layout | ✅ Editor groups, terminal panes | ❌ Not populated |
| Audio capture | WebviewPanel → postMessage IPC | Direct `getUserMedia` |
| Timer accuracy | Extension host Node.js (drifts under load) | Browser main thread (frame-aligned) |
| 16ms realism | Aspirational | Achievable |

The browser adapter has `initialEntity?: SemanticEntity` as optional in its constructor, versus VS Code's required `initialActiveEntity`. This difference reflects a real UX distinction: a browser page has a sensible default entity (the viewport), while a VS Code extension host without an open file has no meaningful default.

---

## Summary

The Tiered Snapshot Engine is USIR's resolution to the AI-speed vs. interaction-speed tension: never block a fast operation on a slow one, and encode the latency promises directly in the type system. `latencyBudgetMs: 16` as a literal type is not pedantry — it is a compile-time guarantee that the Hot tier's contract cannot be silently degraded.

The three tiers are independent debounced state machines with a shared `version` counter. The VS Code event wiring maps each VS Code event to exactly the right tier — cursor moves go to Hot only, document edits go to both Warm and Cold. The `assemble(includeCold: boolean)` interface lets the runtime choose its context depth per request.

The WebviewAudioCapture is the honest acknowledgment that the extension host is not a real-time environment. Rather than fight the Node.js thread's timer accuracy, USIR moves audio capture into the webview where `requestAnimationFrame` and `getUserMedia` actually work, and crosses the boundary via `postMessage` at utterance granularity. It is the right architectural compromise, with known costs: utterance timestamps are in the webview context, cursor state is in the extension host, and stitching them together correctly is work the current implementation defers.

The critical gap — `HotTier.toSnapshot()` not serializing `selections` and `pointerTarget` — means the snapshot protocol's promise and the implementation's delivery are misaligned. `handleInstruction` works around this by reading tier state directly rather than through the snapshot API. This works, but it breaks the abstraction that `SemanticSnapshot` is the complete, authoritative view of adapter state. Closing this gap before the beta would significantly simplify the runtime's intent-building logic.

Next in Part 5: L0.5 Provenance. Every mutation to the `SemanticGraph` is being watched. We'll see how `ProvenanceStore` hooks into `addEntity`, what a mutation event looks like, and why provenance is the safety primitive that makes agentic delegation trustworthy.

---

*USIR Deep-Dive Blog Series — Act I: The Foundation*
*← [Part 3: Semantic Entities](./usir-part3-semantic-entities.md) | [Part 5: L0.5 Provenance](./usir-part5-provenance.md) →*

*Code references: `packages/protocol/src/snapshot/index.ts`, `adapters/vscode/src/snapshot/`, `adapters/browser/src/snapshot/`, `apps/vscode-extension/src/extension.ts`, `apps/vscode-extension/src/audio/webview-audio-capture.ts`*
