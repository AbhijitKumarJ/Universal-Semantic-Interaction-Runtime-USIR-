# Turn 46 — USIR

> **USIR responded:**

# Beyond the GUI, Part 3: The Adapter Layer — Taming Legacy State in <16ms

In Part 2, we designed the **Universal Protocol**: a pristine, abstract language of `SemanticEntities`, `UniversalIntents`, and `SemanticSnapshots`. It is a beautiful theory. But computing isn't built on pristine theory; it is built on legacy applications, messy DOMs, and decades-old APIs.

To make the Universal Semantic Interaction Runtime (USIR) a reality, we have to bridge the gap between abstract meaning and actual software. This is the job of the **Adapter Layer**.

An adapter sits on top of an existing application and translates its internal state into our `SemanticSnapshot`. But doing this introduces a massive engineering hazard: **Latency**.

If an AI agent needs a snapshot of the IDE every time a user speaks a command, the naive approach is to walk the accessibility tree, poll the file system, and query the Language Server Protocol (LSP) all at once. Doing this synchronously on the main thread will lock up the UI, causing unbearable jitter. Doing it asynchronously means the snapshot will be stale by the time the AI tries to use it.

In this post, we will look inside `@usir/vscode-adapter` and explore the architectural pattern that solves this: **The Tiered Snapshot Engine**.

---

### The Anatomy of Latency
To build a system that feels like pair-programming with an instantaneous co-pilot, we must categorize application state by its rate of change. 

If you recompute everything on every keystroke, you kill performance. Instead, our `SnapshotEngine` splits state into three distinct tiers—**Hot**, **Warm**, and **Cold**—each updating at completely different intervals, triggered by specific events rather than aggressive polling.

#### Tier 1: Hot (16ms) — The Invocation Anchor
The Hot tier is the smallest, cheapest slice of state. It represents exactly what the user is doing *right now*: the active file, the cursor position, and any highlighted text.

This tier must be synchronous and pure. It requires no I/O and no deep parsing. It simply reads the in-memory editor model.

Here is a simplified look at `packages/adapters/vscode/src/snapshot/hot.ts`:

```typescript
import * as vscode from 'vscode';

export class HotTier {
  public activeEntityId: string | null = null;
  public selections: string[] = [];
  
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(private onUpdate: () => void) {
    // Event-driven: fires on every cursor movement
    vscode.window.onDidChangeTextEditorSelection(e => {
      this.scheduleUpdate(e.textEditor);
    });
  }

  private scheduleUpdate(editor: vscode.TextEditor) {
    if (this.debounceTimer) return;

    // Coalesce burst events (like holding down an arrow key) into ~16ms frames
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      
      const doc = editor.document;
      const cursor = editor.selection.active;

      // Assign a strict Semantic Entity ID
      this.activeEntityId = `file://${doc.uri.fsPath}#L${cursor.line}`;
      
      this.selections = editor.selections
        .filter(s => !s.isEmpty)
        .map(s => doc.getText(s));

      this.onUpdate();
    }, 16); 
  }
}
```
**Why this matters:** When a user says *"Explain this,"* the audio pipeline fires instantly. The Hot tier provides the **Invocation Anchor**. The LLM knows *exactly* which line the cursor was on at the millisecond the speech ended, serving as a zero-latency anchor to route the intent, even if the user has already clicked away to another file.

#### Tier 2: Warm (150ms) — Semantic Enrichment
The Warm tier contains the semantic richness that makes an IDE powerful: type definitions, hover info, and diagnostics (errors/warnings). 

These are computationally expensive to calculate and rely on asynchronous Language Server (LSP) responses. Therefore, we debounce them heavily.

```typescript
// inside warm.ts
vscode.languages.onDidChangeDiagnostics(e => {
  if (this.debounceTimer) clearTimeout(this.debounceTimer);

  // Wait 150ms for LSP bursts to settle (e.g., during a refactor)
  this.debounceTimer = setTimeout(() => {
    this.diagnostics = e.uris.flatMap(uri => 
      vscode.languages.getDiagnostics(uri).map(diag => ({
        id: `diag://${uri.fsPath}#L${diag.range.start.line}-${diag.code}`,
        name: diag.message,
        role: 'error',
        relations: { 'affects_file': [`file://${uri.fsPath}`] }
      }))
    );
    this.onUpdate();
  }, 150);
});
```

#### Tier 3: Cold (5s+) — Workspace Awareness
The Cold tier represents massive, slow-moving state: the project dependency graph, the file tree, and git status. 

We only update this tier when high-level workspace events occur (e.g., saving a file, creating a new folder, switching git branches). It is cached aggressively and invalidated only when necessary.

---

### Projection on Read, Not Write
Even with this efficient tiered updating, if you send the full assembled graph to the LLM on every voice command, you will consume 8,000+ tokens per request. Most of that context will be entirely irrelevant to the user's intent.

The secret to low-latency LLM routing is **Projection**.

When the Intent Router receives a command, it doesn't ingest the entire `SemanticSnapshot`. It queries a *trimmed projection*.
*   If the intent is *"Go to definition,"* the router only requests Tier 1 (the symbol under the cursor) and Tier 2 (the LSP resolved definition).
*   If the intent is *"Run the tests for this,"* it requests Tier 1 (the function) and Tier 3 (the project file map to find the associated `.test.ts` file).

### The Event Bridge: Turning the AI into a Participant
Up to this point, the adapter is a passive receiver of commands. But a true Ambient Computing OS should be proactive. 

Because our `SnapshotEngine` is entirely event-driven, we can build a **Bidirectional Event Bridge**.

If a new syntax error pops up on line 142, the LSP fires an event. The Warm Tier debounces it and updates the Semantic Graph. The Runtime notices this new `error` entity, cross-references it with the user's current session goal (e.g., "Refactoring the webhook handler"), and proactively sends an intent *back* to the user:

*"There is a new type error on line 142—do you want me to fix it?"*

### The Path to Standardization
By building this adapter for VS Code, we validate the hardest part of the USIR architecture. But the beauty of the adapter pattern is its portability.

Because VS Code now speaks `SemanticSnapshot`, the `@usir/runtime` never needs to know anything about VS Code's specific APIs. It just knows how to manipulate Semantic Graphs. 

Tomorrow, you can write an adapter that parses the DOM and Accessibility Tree of a web browser. The day after that, you can write an adapter for Figma's plugin API. As long as they output a `SemanticSnapshot`, they share the exact same Universal Intent Language.

---
**Next up in Part 4:** *The Runtime — Giving AI a Memory and a Topo-Executor.* We will dive into `@usir/runtime`, explore how to handle conversational pronouns like "the previous one," and build the execution engine that forces the LLM to output safe, deterministic JSON plans instead of executing code directly.