# Part 10: The VS Code Extension — Anatomy of an MVP That Proves an Architecture

> **Series:** Decoding the Post-GUI Runtime | **Act II — The Machine in Motion**
> *← [Part 9: The Audio Pipeline](/part-9-audio-pipeline) | [Part 11: Federation](/part-11-federation) →*

---

Every ambitious architecture eventually reaches the moment of truth: can it be assembled into something that actually runs? For USIR, that moment is `extension.ts`. Nine packages, eight subsystems, one file that wires them together and hands the result to VS Code's extension host. At 420 lines, it is among the most information-dense files in the repo — not because it contains complex logic, but because it is a *composition manifest*: the document that proves all the pieces fit.

This post dissects that file as an architectural specimen. We will trace the activation sequence step by step, examine the nine VS Code tools that map protocol intents to editor API surface, understand why the Cold tier's BFS boundary is not optional, and look honestly at what the current implementation does not yet do.

---

## The Extension at a Glance

The package manifest tells the story before a single line of source is read:

```json
{
  "name": "@usir/vscode-extension",
  "displayName": "USIR — Universal Semantic Interaction",
  "description": "Voice-native, intent-driven interface for VS Code. Speak naturally to navigate, edit, and orchestrate your workspace.",
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "dependencies": {
    "@usir/protocol": "workspace:*",
    "@usir/runtime": "workspace:*",
    "@usir/audio-pipeline": "workspace:*",
    "@usir/vscode-adapter": "workspace:*"
  }
}
```

Four workspace dependencies. All four are required — there is no optional dependency here. `@usir/protocol` provides the entity and intent types; `@usir/runtime` provides the router, executor, memory, provenance, and trust infrastructure; `@usir/audio-pipeline` provides VAD, STT, and `FusedIntent`; and `@usir/vscode-adapter` provides the snapshot engine and tool registry. Remove any one of them and the extension does not compile.

`activationEvents: ["onStartupFinished"]` means the extension activates immediately when VS Code finishes loading, not lazily on first use. We will return to the implications of this later.

---

## The Global State Problem

Before reading `activate()`, examine the module-level declarations:

```typescript
let snapshotEngine: SnapshotEngine;
let toolRegistry: VSCodeToolRegistry;
let llmRouter: LLMRouter;
let executor: TopologicalExecutor;
let provenanceStore: ProvenanceStore;
let interactionMemory: InteractionMemory;
let a2uDispatcher: A2UDispatcher;
let audioCapture: WebviewAudioCapture | null = null;
let whisperClient: STTProvider;
```

Nine module-level `let` declarations. This is worth pausing on. In a TypeScript module, these are effectively global singletons for the lifetime of the extension host process. VS Code extensions are never unloaded mid-session — they are either active or deactivated — so this is pragmatically safe. But it means there is no dependency injection, no service container, and no way to run two instances of the USIR runtime in the same extension host. The comment in the plan acknowledges this implicitly: "The extension is correctly structured to support lazy-activation... but it is not yet implemented." The module-level `let`s are the current structural barrier to that goal.

---

## `activate()` — The Orchestration Sequence

The activation function initializes all nine subsystems in a deliberate order that respects their dependency relationships. Reading it is like reading a boot sequence — each step has a reason for its position.

### Step 1: Snapshot Engine

```typescript
const activeEditor = vscode.window.activeTextEditor;
const initialEntity = createEntity({
  id: activeEditor ? activeEditor.document.uri.toString() : 'file:///untitled',
  role: 'source_file',
  displayName: activeEditor?.document.fileName ?? 'untitled',
});
snapshotEngine = new SnapshotEngine(initialEntity);
```

The snapshot engine is first because everything downstream depends on it. The `initialEntity` seed is what puts the Hot tier in a defined state before any VS Code events have fired. Without it, the first voice command could arrive before any editor event, and `snapshotEngine.hot.pointerTarget` would be `null` with no meaningful context.

The `createEntity` factory is imported from `@usir/protocol/entities` rather than constructing a raw object. This is the correct pattern — the factory sets `version`, `createdAt`, and `updatedAt` fields and ensures the shape matches the `SemanticEntity` protocol type. Constructing raw objects here would bypass those invariants.

### Step 2: Tool Registry

```typescript
toolRegistry = new VSCodeToolRegistry();
```

One line. `VSCodeToolRegistry` self-registers all nine tools in its constructor. The registry is initialized before the router because the router's `getToolRegistryJson` callback reads from it:

```typescript
llmRouter = new LLMRouter({
  // ...
  getToolRegistryJson: async () => JSON.stringify(toolRegistry.toJSON()),
  getAvailableEntityIds: async () =>
    Array.from(snapshotEngine.cold.exportGraph().nodes.keys()),
});
```

These callbacks are closures over the module-level `toolRegistry` and `snapshotEngine` — they are evaluated lazily at routing time, not at initialization time. This is the correct design: the router does not capture a snapshot of the registry at construction; it queries the live registry on every call. Adding a tool after initialization would work without restarting the router.

The `getAvailableEntityIds` callback is similarly live: it reads from `snapshotEngine.cold.exportGraph()` at route time. This means the LLM router always sees the most current Cold tier graph, even if the workspace has changed since the last snapshot.

### Step 3: LLM Router

```typescript
const config = vscode.workspace.getConfiguration('usir');
const apiKey = (config.get('openaiApiKey') as string) ?? process.env.OPENAI_API_KEY ?? '';
if (!apiKey) {
  vscode.window.showWarningMessage(
    'USIR: No OpenAI API key configured. Set `usir.openaiApiKey` in settings.',
  );
}
llmRouter = new LLMRouter({
  config: {
    endpoint: (config.get('llmEndpoint') as string) ?? 'https://api.openai.com/v1',
    apiKey,
    model: (config.get('llmModel') as string) ?? 'gpt-4o',
    temperature: 0,
  },
  getToolRegistryJson: async () => JSON.stringify(toolRegistry.toJSON()),
  getAvailableEntityIds: async () =>
    Array.from(snapshotEngine.cold.exportGraph().nodes.keys()),
});
```

`temperature: 0` is non-negotiable and hardcoded — see Part 7 for the rationale. The model defaults to `gpt-4o` but is configurable, meaning you can point the extension at a local Ollama endpoint running `qwen2.5-coder` if you want fully offline routing. The endpoint abstraction in `LLMRouter` makes this work without any other code change.

The `if (!apiKey)` path shows a warning but does not abort activation. This is the right choice: the extension can still work in read-only exploration mode (snapshot viewing, provenance inspection) even without an LLM key. Aborting activation would remove value the user is entitled to.

### Steps 4 and 5: Executor, Provenance, Memory, A2U

```typescript
executor = new TopologicalExecutor(toolRegistry);
provenanceStore = new ProvenanceStore();
interactionMemory = new InteractionMemory('user-1');

const trustClassifier = new TrustClassifier();
a2uDispatcher = new A2UDispatcher(trustClassifier, provenanceStore, executor);
```

The dependency graph here is: `executor` depends on `toolRegistry`; `a2uDispatcher` depends on all three (`trustClassifier`, `provenanceStore`, `executor`). The initialization order reflects this. `InteractionMemory('user-1')` is the only place user identity appears in the current codebase — a hardcoded string that Part 14 (critical analysis) will correctly flag as a missing identity layer.

### Step 6: Whisper Client

```typescript
const fastWhisper = new FastWhisperClient({
  apiKey: (config.get('groqApiKey') as string) ?? process.env.GROQ_API_KEY ?? '',
});
const localWhisper = new LocalWhisperClient({
  binaryPath: config.get('localWhisperBinary') as string | undefined,
  modelPath: config.get('localWhisperModel') as string | undefined,
});
whisperClient = new FallbackWhisperClient(localWhisper, fastWhisper);
```

Local-first, cloud-fallback. This was covered in depth in Part 9. The important detail here is that `whisperClient` is assigned at activation, not at first push-to-talk. The `LocalWhisperClient` object is constructed, but the underlying binary process is not spawned until `transcribe()` is called. Model load cost is deferred to first command — the cold-start problem from Part 9 is still present.

### Step 7: VS Code Event Listeners

Five event subscriptions are registered here. These are what keep the snapshot engine live:

```typescript
vscode.window.onDidChangeActiveTextEditor((editor) => {
  if (editor) {
    const entity = createEntity({ id: editor.document.uri.toString(), ... });
    snapshotEngine.hot.updateActiveEntity(entity);
    interactionMemory.pushToHistory(entity.id);
  }
}),

vscode.window.onDidChangeTextEditorSelection((e) => {
  // Update hot tier selection + pointer target from cursor position
  const pos = e.selections[0]?.active;
  if (pos) {
    snapshotEngine.hot.updatePointerTarget({
      entityId: entity.id,
      bounds: { x: pos.character, y: pos.line, width: 1, height: 1 },
    });
  }
}),

vscode.workspace.onDidChangeTextDocument((e) => {
  snapshotEngine.cold.addEntity(entity);
  snapshotEngine.warm.recordChange(entity, { version: e.document.version });
}),

vscode.workspace.onDidOpenTextDocument((doc) => {
  snapshotEngine.cold.addEntity(entity);
}),

vscode.window.onDidChangeWindowState((state) => {
  if (state.focused) snapshotEngine.hot.updateActiveEntity(...);
}),
```

These five listeners are the *entire bridge* between VS Code's event model and the USIR runtime. Every Hot tier update flows through `onDidChangeTextEditorSelection`. Every Cold tier addition flows through `onDidChangeTextDocument` and `onDidOpenTextDocument`. There is no polling anywhere.

The cursor position is encoded as spatial bounds with `width: 1, height: 1`:

```typescript
snapshotEngine.hot.updatePointerTarget({
  entityId: entity.id,
  bounds: { x: pos.character, y: pos.line, width: 1, height: 1 },
});
```

This maps a 1D cursor position (line/column) into the 2D `PointingTarget.bounds` field that `buildFusedIntent` expects. The `width: 1, height: 1` is a correct minimum-size bounding box for a cursor insertion point. In the browser adapter, bounds are real pixel rectangles from `getBoundingClientRect()`; in the VS Code adapter, they are character-grid coordinates. The shared `PointingTarget` interface handles both because neither the router nor the memory layer cares about the coordinate system — they care about the `entityId`.

### Steps 8 and 9: Commands and Status Bar

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('usir.startListening', () => startListening(context)),
  vscode.commands.registerCommand('usir.stopListening', () => stopListening()),
  vscode.commands.registerCommand('usir.showSnapshot', () => showSnapshot()),
  vscode.commands.registerCommand('usir.showProvenance', () => showProvenance()),
);

const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBar.text = '$(mic) USIR';
statusBar.tooltip = 'USIR -- press Ctrl+Shift+Space to start voice';
statusBar.command = 'usir.startListening';
statusBar.show();
```

The status bar item is the only persistent UI element the extension creates. Its `command: 'usir.startListening'` means clicking it is equivalent to pressing `Ctrl+Shift+Space`. This is the correct first-install discovery path: the user sees the microphone icon, clicks it, and enters listening mode without needing to know the keybinding.

The four registered commands map to the four user-facing operations. There is no `usir.routeIntent` command exposed — intent routing is always triggered by audio, never by direct command. This is consistent with voice-first design: text commands are the disambiguation fallback, not the primary path.

---

## The Keybinding: `Ctrl+Shift+Space`

```json
"keybindings": [
  {
    "command": "usir.startListening",
    "key": "ctrl+shift+space",
    "mac": "cmd+shift+space",
    "when": "editorTextFocus"
  }
]
```

Two design decisions are encoded here. First, `when: "editorTextFocus"` scopes the keybinding to contexts where the editor text area has focus. This prevents push-to-talk from firing when a terminal, file explorer, or dialog has focus — contexts where the Hot tier pointer target would be ambiguous or wrong. Second, there is no keybinding for `usir.stopListening`. Stopping is handled by `Escape` (registered as `usir.cancelListening` inside `startListening`) rather than the same chord. Push-to-hold semantics — where you hold the key and release to stop — are not implemented; the current model is toggle: one press starts, `Escape` stops.

A push-to-hold model would require `keydown` and `keyup` events. VS Code's keybinding system does not expose `keyup` natively. Implementing true walkie-talkie PTT would require a native keyboard hook or a custom webview with its own `keydown/keyup` listeners — another place where the extension host's capability limitations push complexity into webviews.

---

## The Instruction Execution Pipeline

When the audio pipeline fires `onUtterance`, the flow lands in `handleInstruction`:

```typescript
async function handleInstruction(rawInstruction: string) {
  // 1. Build FusedIntent from voice + Hot tier context
  const pointingTarget = snapshotEngine.hot.pointerTarget ? { ... } : null;
  const fused = buildFusedIntent({
    linguisticInput: rawInstruction,
    pointingTarget,
    implicitSignals: { cursorDwellTimeMs: 0, typingCadence: 'idle' },
    sources: ['voice', 'mouse'],
  });

  // 2. Push pointing target to memory
  if (fused.pointingTarget) {
    interactionMemory.pushToHistory(fused.pointingTarget.entityId, { rawInput: rawInstruction });
  }

  // 3. Route through LLM
  const snapshot = snapshotEngine.assemble(false);
  const plan = await llmRouter.route({ rawInstruction, snapshot, memory: interactionMemory.snapshot() });

  // 4. Handle ambiguities
  if (plan.ambiguities.length > 0) {
    await handleAmbiguities(plan);
    return;
  }

  // 5. Execute the plan
  const result = await executor.execute(plan);
  if (!result.success) {
    vscode.window.showErrorMessage(`USIR plan failed: ${result.failedStepIds.join(', ')}`);
  } else {
    vscode.window.showInformationMessage(
      `USIR completed ${result.stepResults.length} steps in ${result.totalDurationMs}ms`
    );
  }
}
```

Several things in this sequence are worth flagging.

`snapshotEngine.assemble(false)` — the `false` argument means "exclude the Cold tier." This is the default path for voice commands. Including the Cold tier on every command would add 1–4 seconds of latency waiting for the BFS traversal. The LLM router is given the Hot and Warm tiers, plus the list of available entity IDs from `getAvailableEntityIds` (which does read the Cold graph, but only IDs — not the full entity objects). This is the right balance: the router knows *what exists* in the workspace without receiving the full context of *every entity's metadata*.

`plan.ambiguities.length > 0` triggers `handleAmbiguities`, which presents a VS Code `QuickPick`. After the user selects, the execution returns with `picked.label` shown as an information message — but does not re-run routing with the selection. This is the current disambiguation stub: it shows the user's choice but does not feed it back into the router. In a complete implementation, `handleAmbiguities` would re-invoke `llmRouter.route` with the resolved choice appended to the `rawInstruction` context.

The A2U dispatcher — initialized in step 5 of `activate()` — is not actually called in `handleInstruction`. The current execution path goes directly from `llmRouter.route()` to `executor.execute()`. The `a2uDispatcher` is wired up and ready but not yet inserted into the hot path. This means the trust gating described in Part 8 (checkpoint for reversible mutations, blocker for irreversible) is bypassed in the current implementation. All plans execute unconditionally. This is the most significant safety gap in the current VS Code extension.

---

## The Nine VS Code Tools

`VSCodeToolRegistry` registers nine tools. Each one is the atomic unit the `TopologicalExecutor` calls during plan execution. Together, they define USIR's complete capability surface within VS Code.

```
┌───────────────────────────┬────────────────────────────────────────────────────────────┐
│ Tool                      │ VS Code API Surface                                        │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ vscode.openEntity         │ workspace.openTextDocument + window.showTextDocument        │
│ vscode.focusRegion        │ commands.executeCommand('workbench.view.*')                 │
│ vscode.editEntity         │ WorkspaceEdit (replace / insert / delete)                  │
│ vscode.executeCommand     │ commands.executeCommand (arbitrary VS Code command)         │
│ vscode.runTests           │ commands.executeCommand('testing.runAll')                   │
│ vscode.runInTerminal      │ window.createTerminal + sendText                            │
│ vscode.search             │ workspace.findFiles + commands.executeCommand('view.search')│
│ vscode.locateSymbol       │ commands.executeCommand('vscode.executeWorkspaceSymbolProvider') │
│ vscode.applyRefactor      │ commands.executeCommand('vscode.executeCodeActionProvider') │
└───────────────────────────┴────────────────────────────────────────────────────────────┘
```

**`vscode.openEntity`** opens a document and positions the cursor to an optional `{line, column}` coordinate. The cursor position uses zero-based indexing internally (`Math.max(0, cursor.line - 1)`) while accepting one-based input from the LLM — a small but important normalization that prevents off-by-one errors when the model says "go to line 42."

**`vscode.focusRegion`** exposes 10 named VS Code regions: `editor`, `explorer`, `terminal`, `search`, `debug`, `extensions`, `settings`, `problems`, `output`, `source-control`. The mapping from region name to VS Code command ID is hardcoded in `regionMap`. Unknown regions fall back to `workbench.action.focusActiveEditorGroup`. This means a voice command like "open the problems pane" routes correctly; "open the timeline view" silently falls back to the editor.

**`vscode.editEntity`** is the most consequential tool — it modifies file content via `WorkspaceEdit`. Three operations: `replace` (full file content replacement), `insert` (append to end of file), and `delete` (clear entire file). This is a rough API. Real refactoring needs range-aware operations: "replace the function on lines 42–67," not "replace the entire file." The `replace` operation works correctly for small files or when the LLM produces a full revised version of the file. For large files it is both slow and lossy — intermediate content the user has not yet saved gets overwritten.

**`vscode.executeCommand`** is the escape hatch: it passes arbitrary VS Code command IDs through to the command registry. This means any VS Code command — including extension-contributed commands — is reachable via voice without an explicit USIR tool binding. The power and risk of this tool are symmetric: "format document on save," "toggle word wrap," "git commit staged changes" all work. So does "workbench.action.reloadWindow."

**`vscode.runTests`** is a delegation wrapper: it focuses the test file and calls `testing.runAll`. The `testName` argument is captured in metadata but not actually used to run a specific test — VS Code's test API requires running through test controllers that are extension-specific, and the current implementation takes the simpler path of running all tests. This is a known gap; targeted test runs would require integration with the VS Code Testing API at the `TestController` level.

**`vscode.runInTerminal`** finds or creates a terminal named "USIR" and sends text to it. The USIR-named terminal is the correct design — it prevents command contamination with the user's active terminal sessions and gives the user a clear audit trail of what USIR executed. One edge case: `terminal.sendText(command)` sends the text *and immediately presses Enter*. There is no confirmation step. A "run command" intent goes directly to execution, which is consistent with the A2U trust tier model (terminal commands are irreversible and should require approval) — but again, the A2U dispatcher is not yet wired.

**`vscode.locateSymbol`** delegates to VS Code's `executeWorkspaceSymbolProvider`, which queries all installed language server extensions (TypeScript, Python, Rust-analyzer, etc.) for symbols matching the name. The `TYPE_MAP` provides kind filtering:

```typescript
const TYPE_MAP: Record<string, vscode.SymbolKind> = {
  function: vscode.SymbolKind.Function,
  class: vscode.SymbolKind.Class,
  variable: vscode.SymbolKind.Variable,
  method: vscode.SymbolKind.Method,
  interface: vscode.SymbolKind.Interface,
  enum: vscode.SymbolKind.Enum,
};
```

This is the only tool in the registry that reads LSP data — everything else operates at the file/cursor level. `locateSymbol` is what makes "find the UserRepository class" work correctly across a large project without the user specifying a file.

**`vscode.applyRefactor`** is the most speculative tool. It calls `vscode.executeCodeActionProvider` on the full range `(0,0)-(0,0)` (the start of the file) and tries to find a code action whose title or kind matches the requested `refactorType`. The range `(0,0)-(0,0)` is the problem: most code actions (extract function, rename, inline variable) are range-sensitive — they only appear when the cursor or selection is in the right position. Calling the provider with a zero range means the returned code actions will typically be file-level actions (organize imports, fix all auto-fixable problems) rather than the targeted refactorings the tool implies. In practice, `vscode.applyRefactor` will work for "organize imports" and "format document" and fail silently for "extract function."

---

## The Cold Tier's Bounded Graph

Part 4 introduced the three-tier snapshot architecture. In the VS Code adapter, the Cold tier's `ColdTier` class is where workspace-scale context lives:

```typescript
export class ColdTier {
  private graph: SemanticGraph = createSemanticGraph();
  private lspMetadata: Map<string, LspEntityMetadata> = new Map();
  private maxDepth: number = 3;  // default BFS depth

  public projectSubgraph(rootId: string, maxDepth?: number): SemanticEntity[] {
    const depth = maxDepth ?? this.maxDepth;
    const out: SemanticEntity[] = [];
    bfs(this.graph, rootId, depth, (id) => {
      const node = this.graph.nodes.get(id);
      if (node) out.push(node.entity);
    });
    return out;
  }
}
```

The critical design constraint is the comment in `cold.ts`:

```typescript
/**
 * The BFS-traversal safety pattern is critical: we never load the full
 * semantic graph synchronously. We use depth-limited BFS from the active
 * entity and lazy-load on demand.
 */
```

Why does this matter? A real TypeScript monorepo might have 50,000 files. The `@usir/protocol` package defines `SemanticEntity` objects that include `displayName`, `spatial`, `context`, `attributes`, and `relations`. Materializing 50,000 of these simultaneously would consume hundreds of megabytes of heap memory in the extension host and take several seconds of blocking CPU time — a latency spike that would freeze the entire VS Code instance.

The `maxDepth: 3` default means: starting from the active file, traverse at most 3 hops along `relations` edges. For a typical codebase, 3 hops from `UserController.ts` might include `UserService`, `UserRepository`, `User` model, and a handful of utility imports — perhaps 20–50 entities. That is the right scope for an LLM context window: enough to understand the immediate dependency graph without drowning in unrelated modules.

The `scheduleUpdate` method uses a 1-second debounce:

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

The `updateScheduled` flag is a leading-edge debounce: the first call schedules the update, all subsequent calls within 1 second are dropped. This is correct for batch file operations — opening 20 files in a tab group fires 20 `onDidOpenTextDocument` events, but the Cold tier only updates once, 1 second after the first event.

A notable gap: the Cold tier's graph is populated *only* by events flowing through the VS Code event listeners in `activate()`. Files that were open before the extension was activated appear in the graph if they trigger `onDidOpenTextDocument` after activation. Files that are part of the workspace but never opened will not appear in the graph unless you open them. The Cold tier is not a full workspace index — it is a partial index of the files the user has touched during this session.

---

## The Two Webview Panels

The extension contributes two observability panels, accessible via command palette.

### Snapshot View

```typescript
function showSnapshot() {
  const snapshot = snapshotEngine.assemble(true);  // include Cold tier
  const panel = vscode.window.createWebviewPanel(
    'usir-snapshot',
    'USIR Semantic Snapshot',
    vscode.ViewColumn.Two,
    { enableScripts: true },
  );
  // ... render hot/warm/cold as colored JSON panels
}
```

The Snapshot View calls `assemble(true)` — including the Cold tier — which is the correct call for inspection: you want to see everything, latency be damned. The HTML uses VS Code's CSS variables (`--vscode-editor-background`, `--vscode-panel-border`) so it automatically matches the user's theme. The three tiers are color-coded:

- **HOT** badge: `#e74c3c` (red — fast, urgent, now)
- **WARM** badge: `#f39c12` (amber — recent, contextual)
- **COLD** badge: `#3498db` (blue — deep, stable, background)

This panel is currently a static JSON dump, refreshed only when you re-invoke the command. A live updating version (using `webview.postMessage` from the VS Code event listeners) would be more useful for debugging but adds complexity. The static version is sufficient for the pre-alpha.

### Provenance View

```typescript
function showProvenance() {
  const graph = provenanceStore.exportGraph();
  const nodes = Array.from(graph.nodes.values());
  // render all provenance nodes as JSON
}
```

The Provenance View exports the entire `ProvenanceStore` graph. As established in Part 5, the provenance store is an append-only log of every mutation with causal chain links. In the current implementation, provenance records are created by the tool implementations — each tool in `vscode-tools.ts` returns a `provenanceId` in its result. However, the `TopologicalExecutor` does not actually write those IDs to the `ProvenanceStore`. The executor returns `provenanceId` in the `ToolResult`, but there is no code that calls `provenanceStore.append()` with that result.

This means the Provenance View will always show "No provenance records yet" until someone wires the executor result → provenance store write path. The field exists on every tool result; the store write is the missing link.

---

## The Activation Cost

The `activate()` function performs nine initialization steps synchronously (or near-synchronously) before returning. Let us estimate the cost:

| Step | Cost |
|------|------|
| SnapshotEngine init | ~1ms — pure object construction |
| VSCodeToolRegistry init | ~1ms — registers 9 closures |
| LLMRouter init | ~1ms — no network calls |
| TopologicalExecutor, ProvenanceStore, InteractionMemory | ~1ms each |
| TrustClassifier + A2UDispatcher | ~1ms |
| LocalWhisperClient + FastWhisperClient + FallbackWhisperClient | ~1ms — no binary spawn yet |
| VS Code event subscriptions (5) | ~1ms |
| Command registrations (4) | ~1ms |
| Status bar creation | ~1ms |

Total: under 15ms. The `activate()` function itself is fast. The cost problem is not in initialization — it is in the *first command*:

- First push-to-talk → creates `WebviewAudioCapture` → spawns webview → loads JavaScript → acquires mic permissions → triggers `onDidReceiveMessage` → WebviewPanel ready
- First utterance → `LocalWhisperClient.transcribe()` → first binary spawn → WAV file write → model load → inference → text returned
- First routing call → `LLMRouter.route()` → OpenAI API call → cold start on LLM side (if no keep-alive)

For a developer with a slow machine and a large model, the first command after a fresh VS Code launch can take 10–20 seconds. This is a UX cliff that the clean architecture papers over.

The fix — pre-warm Whisper during `activate()`, pre-warm the webview before first PTT, pre-take the Cold tier snapshot — is structurally supported. It is not implemented.

---

## What `extension.ts` Proves

Take a step back from the gap analysis. What `extension.ts` successfully demonstrates is architecturally significant:

Every subsystem covered in Parts 2–9 of this series — the intent ontology, the snapshot engine, the interaction memory, the LLM router, the topological executor, the A2U dispatcher, and the audio pipeline — is assembled and wired in 420 lines without any subsystem being tightly coupled to any other. The snapshot engine does not know the router exists. The router does not know the executor exists. The audio pipeline does not know the A2U dispatcher exists. They are connected only through `handleInstruction`, a 60-line function that sequences their composition.

This is the correct shape for a protocol runtime. When the `BrowserAdapter` replaces the `VSCodeAdapter`, only the snapshot engine and tool registry change — the router, executor, memory, and provenance store are unchanged. When the `XRAdapter` adds a gaze tracker, it feeds into `buildFusedIntent` via the `PointingTarget` field — the router receives it transparently.

The architecture is genuinely modular in the place where modularity matters: at the adapter boundary. `extension.ts` is the proof.

---

## Critical Take

The series plan's critical take is direct: "extension.ts currently activates all subsystems eagerly on extension activation. For a developer who never uses voice, this is dead weight."

This is true, and the remedy is clear. The lazy-activation model would look like:

```typescript
// activate() — register commands and status bar only
// startListening() — initialize all subsystems on first use

async function ensureInitialized(context: vscode.ExtensionContext) {
  if (snapshotEngine) return;  // already initialized
  // ... all of the current activate() steps 1-7
}

async function startListening(context: vscode.ExtensionContext) {
  await ensureInitialized(context);
  // ... current startListening() body
}
```

There is one subtlety: the VS Code event listeners in step 7 should still register eagerly, because they feed the snapshot engine — and the snapshot engine needs to have seen the user's navigation history to resolve references like "the file I was just in." If the listeners only activate on first push-to-talk, then a user who opens three files, writes some code, and then says "revert the file I had open before this one" will get a wrong answer because the memory is empty.

The correct lazy model is: event listeners activate immediately, snapshot engine activates immediately, everything else (router, executor, audio, A2U) activates on first push-to-talk. This reduces startup overhead by roughly 60% while preserving the context capture that makes voice commands useful.

As of the pre-alpha, this optimization is correctly scoped, completely unimplemented, and waiting.

---

*This concludes Act II. We have followed USIR from its memory model through routing, execution, trust gating, audio capture, and assembly into a working extension. Act III begins with the most ambitious unimplemented layer:*

*Next: **[Part 11: Federation — P2P Semantic Graphs Over WebRTC](/part-11-federation)** — how USIR connects runtimes across machines, the CRDT-backed graph sync that makes concurrent editing consistent, and the gap between a brilliant architecture and a deployment-ready product.*

---

**Code touchpoints for this post:**
- `apps/vscode-extension/src/extension.ts`
- `apps/vscode-extension/package.json`
- `adapters/vscode/src/registry/vscode-tools.ts`
- `adapters/vscode/src/snapshot/cold.ts`
- `adapters/vscode/src/snapshot/engine.ts`
- `adapters/vscode/src/snapshot/hot.ts` (from ideation; not in direct repo extract)
