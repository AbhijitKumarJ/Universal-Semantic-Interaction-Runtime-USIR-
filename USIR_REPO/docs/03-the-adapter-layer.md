# Beyond the GUI, Part 3: The Adapter Layer — Taming Legacy State in <16ms

In [Part 2](./02-the-universal-protocol.md), we designed the **Universal Protocol**: a pristine, abstract language of `SemanticEntities`, `UniversalIntents`, and `SemanticSnapshots`. It is a beautiful theory. But computing isn't built on pristine theory; it is built on legacy applications, messy DOMs, and decades-old APIs.

To make the Universal Semantic Interaction Runtime (USIR) a reality, we have to bridge the gap between abstract meaning and actual software. This is the job of the **Adapter Layer**.

An adapter sits on top of an existing application and translates its internal state into our `SemanticSnapshot`. But doing this introduces a massive engineering hazard: **Latency**.

If an AI agent needs a snapshot of the IDE every time a user speaks a command, the naive approach is to walk the accessibility tree, poll the file system, and query the Language Server Protocol (LSP) all at once. Doing this synchronously on the main thread will lock up the UI, causing unbearable jitter. Doing it asynchronously means the snapshot will be stale by the time the AI tries to use it.

In this post, we will look inside `@usir/vscode-adapter` and explore the architectural pattern that solves this: **The Tiered Snapshot Engine**.

## The Anatomy of Latency

To build a system that feels like pair-programming with an instantaneous co-pilot, we must categorize application state by its rate of change.

If you recompute everything on every keystroke, you kill performance. Instead, our `SnapshotEngine` splits state into three distinct tiers—**Hot**, **Warm**, and **Cold**—each updating at completely different intervals, triggered by specific events rather than aggressive polling.

### Tier 1: Hot (16ms) — The Invocation Anchor

The Hot tier is the smallest, cheapest slice of state. It represents exactly what the user is doing *right now*: the active file, the cursor position, and any highlighted text.

In `adapters/vscode/src/snapshot/hot.ts`:

```typescript
export class HotTier {
  public activeEntity: SemanticEntity;
  public activeRegion: string = 'editor';
  public selections: SemanticEntity[] = [];
  public pointerTarget: { entityId: string; bounds: SpatialBounds } | null = null;
  
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  public updateActiveEntity(entity: SemanticEntity, region: string = 'editor'): void {
    this.activeEntity = entity;
    this.activeRegion = region;
    this.recordEphemeral(entity.id, 'open');
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 16);  // ~1 frame at 60fps
  }
}
```

The Hot tier is event-driven. We listen to `vscode.window.onDidChangeActiveTextEditor` and `onDidChangeTextEditorSelection`—these fire instantly when the user moves the cursor or switches files. We debounce the actual update notification to 16ms (one frame) so the runtime isn't spammed.

The cost of the Hot tier is **negligible**: it's a single object with ~5 fields. Computing it takes < 1ms. Sending it to the LLM takes < 5ms on a typical broadband connection.

### Tier 2: Warm (150ms) — The Visible Context

The Warm tier is what the user can currently *see* on the screen: the file tree, the open tabs, the terminal panes, the visible lines of code.

```typescript
export class WarmTier {
  public visible: Map<string, SemanticEntity> = new Map();
  public recentlyChanged: Array<{ entity: SemanticEntity; delta: Record<string, unknown> }> = [];
  public panelLayout: Array<{ panelId: string; kind: string; bounds: SpatialBounds }> = [];

  public setVisible(entities: SemanticEntity[]): void {
    this.visible.clear();
    for (const e of entities) this.visible.set(e.id, e);
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 150);
  }
}
```

150ms is the threshold where humans perceive something as "responsive" but the system has time to do meaningful work. The Warm tier aggregates the visible entities from all panels and tracks what's changed in the last few seconds. This is what the LLM uses to resolve *"the panel on the right"*—it looks at the `panelLayout` and finds the matching region.

### Tier 3: Cold (Seconds) — The Full Graph

The Cold tier is the heavyweight. It's the full semantic graph: every file, every function, every LSP symbol, every diagnostic, every dependency relationship.

```typescript
export class ColdTier {
  private graph: SemanticGraph = createSemanticGraph();
  private lspMetadata: Map<string, LspEntityMetadata> = new Map();
  private maxDepth: number = 3;

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

The Cold tier uses **bounded BFS**. We never load the full graph synchronously. When the LLM needs context about a function, we project a 3-deep subgraph rooted at that function, lazy-loading LSP metadata on demand.

The Cold tier is updated by file-system watchers and LSP notifications, debounced to 1 second. If the user is editing a file, the graph version increments; if a different file changes, we don't re-walk the graph for nothing.

## The SnapshotEngine: Orchestrating the Three Tiers

The `SnapshotEngine` is what the runtime actually talks to. It exposes two assembly methods:

```typescript
export class SnapshotEngine {
  public assemble(includeCold: boolean = false): SemanticSnapshot { ... }
  public hotOnly(): SemanticSnapshot { ... }
}
```

`hotOnly()` is the fast path. It returns a snapshot with just the Hot tier and an empty Warm tier. The runtime calls this for the *first* LLM request when the user finishes speaking a command. The cost is dominated by network latency to the LLM, not by snapshot assembly.

`assemble(includeCold)` is the slow path. It's called on the *second* iteration, when the LLM has identified what entities it needs more context about. The runtime then asks the Cold tier for a bounded subgraph and includes it in the next LLM request.

This is the **two-wave context gathering** pattern:
1. **Wave 1 (Hot):** Send the cursor/focus state. The LLM says "I think I know what you mean, but I need more context about file X."
2. **Wave 2 (Cold):** Send a subgraph rooted at X. The LLM returns a full execution plan.

Total time: < 2 seconds for a complex multi-step command. For simple commands (most), the LLM can answer in Wave 1 alone, in < 500ms.

## Tool Registry: The Other Half of the Adapter

The snapshot is read-only. To actually *do* things, the adapter exposes a `ToolRegistry`:

```typescript
export class VSCodeToolRegistry extends ToolRegistry {
  constructor() {
    super();
    this.registerVSCodeTools();
  }
  
  private registerVSCodeTools(): void {
    this.register({
      name: 'vscode.openEntity',
      description: 'Open a file in the editor',
      execute: async (args) => { /* real implementation */ }
    });
    this.register({
      name: 'vscode.runInTerminal',
      description: 'Execute a command in the integrated terminal',
      execute: async (args) => { /* ... */ }
    });
    this.register({
      name: 'vscode.applyRefactor',
      description: 'Apply a code refactoring',
      execute: async (args) => { /* ... */ }
    });
    // ... 9 tools total
  }
}
```

The LLM is told about these tools in its system prompt. When it generates an `ExecutionPlan`, the steps reference these tool names. The `TopologicalExecutor` (covered in Part 4) then invokes them with the resolved arguments.

## What About Non-Native Apps?

The VS Code adapter is "native" because VS Code exposes rich semantic APIs. But most software doesn't. For those cases, we have the **Zero-Shot Adapter** architecture (covered in detail in the Semantic Horizon series): use a Vision-Language Model as a JIT compiler at app-load time, generating a deterministic semantic map once, then using < 16ms hooks for all subsequent interactions.

## What's Next

The adapter gives us a live, sub-16ms semantic state. But a snapshot is just a frozen moment. Humans don't speak in frozen moments—they speak in conversation. In [Part 4](./04-the-runtime.md), we will build the Runtime: the brain that gives AI a memory and a topological executor.

---

**Next:** [Part 4: The Runtime — Giving AI a Memory and a Topo-Executor](./04-the-runtime.md)
