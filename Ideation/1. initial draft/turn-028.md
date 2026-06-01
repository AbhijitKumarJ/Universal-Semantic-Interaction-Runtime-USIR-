# Turn 28 — USIR

> **USIR responded:**

**Defining the Objective**

I'm currently focused on defining the primary objective: creating a comprehensive repository map for this new open-source project. This map needs to reflect the discussion so far and ensure the architecture is sound. I'm prioritizing accuracy and clarity in representing the project's structure.


**Mapping the USIR Architecture**

I'm now diving deep into mapping the "Universal Semantic Interaction Runtime (USIR)" and "Universal Interaction Language (UIL)", beginning with the Audio-Native IDE extension MVP. I am focusing on the key components: the Core Protocol/Ontology (USIR/UIL) with its schemas and intents, the Runtime/Orchestrator's role, and the Adapters (IDE, and future ones). I'm also considering modality inputs like voice/audio and the IDE Extension as the MVP entry point, and structuring the repo as a monorepo.


**Structuring the Monorepo**

I've decided that a monorepo structure makes the most sense. I'm leaning toward using Turborepo (or npm/pnpm workspaces) to manage the project. This will allow for concurrent development of the protocol, the runtime, and the different implementations. I'm envisioning a directory structure with "packages/" for shared libraries/core logic, "adapters/" for application translators, "apps/" for end-user products like the VS Code extension, and "docs/" for research and specifications. I am starting to flesh out the contents of each directory.


**Detailing the MVP Implementation**

I'm now deep-diving into the specifics of the VS Code MVP implementation. I'm focusing on the `adapters/vscode`, `packages/runtime`, and `packages/protocol` modules, creating the specific file structure like `snapshot/hot.ts`, `llm-router.ts` and `intents.ts` within the respective modules. I'm detailing the hot, warm, and cold snapshots, executor mapping intents, the LLM router, memory handling, and UI disambiguation. I am also currently working on the structure of the ontology and categorized intents, preparing the draft response, including an introduction and directory tree, for clarity.




Here is a comprehensive repository map for **USIR** (Universal Semantic Interaction Runtime), structured as a modern TypeScript Monorepo (using Turborepo/pnpm). 

This architecture explicitly separates the **Universal Ontology** and **Semantic Runtime** from the **VS Code Adapter MVP**, ensuring the codebase can easily scale to browsers and OS-level integrations later.

### **Repository Structure: `usir-monorepo/`**

```text
usir-monorepo/
├── docs/                               # Research, specs, and ontology definitions
│   ├── ontology/                       # The Universal Intent Ontology (v0.1)
│   │   ├── L1_navigation.md            # Locate, Open, Close, Navigate
│   │   ├── L4_manipulation.md          # Edit, Rename, Move
│   │   └── references.md               # Spatial, Temporal, Conversational rules
│   └── architecture/                   # System diagrams and tier definitions
│
├── packages/                           # Core framework (App & Modality Agnostic)
│   ├── protocol/                       # Universal Interaction Language (UIL)
│   │   ├── src/
│   │   │   ├── intents/                # Schema definitions (Zod/TS) for the ~50 universal intents
│   │   │   ├── entities/               # Generic entities (File, Block, Error, Node)
│   │   │   └── graph/                  # Semantic Graph edges (contains, relates_to, next_to)
│   │   └── package.json
│   │
│   ├── runtime/                        # The Brain: Processes intents, memory, and routing
│   │   ├── src/
│   │   │   ├── memory/                 # Interaction Memory (resolving "it", "that", "previous")
│   │   │   ├── router/                 # Intent Router (LLM prompt assembly & classification)
│   │   │   ├── executor/               # Topological Executor (handles dependencies and parallel execution)
│   │   │   └── disambiguation/         # Collaborative narrowing logic (identifying multiple matches)
│   │   └── package.json
│   │
│   └── audio-pipeline/                 # Modality: Real-time Audio
│       ├── src/
│       │   ├── vad.ts                  # Voice Activity Detection (streaming)
│       │   ├── whisper-client.ts       # Low-latency STT connection
│       │   └── fused-intent.ts         # Merges Audio (Linguistic) with Cursor (Pointing)
│       └── package.json
│
├── adapters/                           # Translates specific apps to Universal Semantic State
│   ├── vscode/                         # Phase 1 MVP: The VS Code / Cursor Adapter
│   │   ├── src/
│   │   │   ├── snapshot/               # State Engine (converts IDE state to Semantic Graph)
│   │   │   │   ├── hot.ts              # 16ms: Cursor, active file, selection
│   │   │   │   ├── warm.ts             # 150ms: LSP diagnostics, references, hover info
│   │   │   │   └── cold.ts             # 5s+: File tree, git state, running tasks
│   │   │   ├── registry/               # Translates Universal Intents to VS Code Commands
│   │   │   └── event-bridge.ts         # Pushes IDE events (new error) back to Runtime
│   │   └── package.json
│   │
│   └── browser/                        # Phase 2 (Stubbed): DOM Adapter
│       └── src/
│           └── dom-to-graph.ts         # Maps DOM / A11y tree to Semantic State
│
└── apps/                               # Deployable targets
    ├── vscode-extension/               # The actual Audio-Native VS Code Extension
    │   ├── src/
    │   │   ├── extension.ts            # Entry point
    │   │   ├── ui/                     # Webviews for Disambiguation overlays (Highlighting A, B, C)
    │   │   └── bridge.ts               # Connects audio-pipeline + runtime + vscode-adapter
    │   ├── package.json
    │   └── vsc-extension-quickstart.md
    │
    └── debug-dashboard/                # A local web UI to visualize the Semantic Graph in real-time
        └── src/                        # (Crucial for debugging the Hot/Warm/Cold tiers)
```

---

### **Deep Dive into Key Modules (The Implementation Plan)**

#### **1. `packages/protocol/src/intents/` (The Vocabulary)**
Instead of hardcoding VS Code commands, this package defines the **Universal Intent Ontology**.
*   **Example:** `OpenIntent.ts`
    ```typescript
    export interface OpenIntent {
      id: "intent.navigation.open";
      target: CognitiveReference | SemanticEntity; // e.g., "that file" or "main.py"
      context: SemanticSnapshot;
    }
    ```

#### **2. `adapters/vscode/src/snapshot/` (The Semantic Graph Engine)**
This is the heart of the MVP. It stops exposing "panels" and starts exposing semantic meaning.
*   **`hot.ts`**: Subscribes to `vscode.window.onDidChangeTextEditorSelection`. Uses `requestAnimationFrame` style debouncing to maintain a live graph node of `Current_Focus`.
*   **`warm.ts`**: Subscribes to `vscode.languages.onDidChangeDiagnostics`. Maps LSP outputs into relationships (`Function_A -> has_error -> Error_X`).
*   **`cold.ts`**: Maps the workspace file tree into a graph, updating only on file save/creation.

#### **3. `packages/runtime/src/memory/` (Interaction Memory)**
Where the magic of conversational UI lives. 
*   **`spatial.ts`**: Looks at the `hot.ts` cursor coordinates to resolve *"the one below that"*.
*   **`temporal.ts`**: Keeps a ring-buffer of recently visited `SemanticEntity` IDs to resolve *"the previous file"*.
*   **`conversational.ts`**: Maps pronouns ("it", "they") to the last active node in the Semantic Graph.

#### **4. `packages/runtime/src/router/` (The LLM Core)**
This module takes the `FusedIntent` (Audio text + Cursor position) and the `SemanticSnapshot` projection, formats it into the highly constrained system prompt, and asks the LLM to output an `ExecutionPlan`.
*   **Single Pass:** It extracts intent and parameters simultaneously.
*   **Confidence Gate:** If confidence is `< 0.85` or ambiguity is detected, it intercepts the execution and routes to `disambiguation.ts`.

#### **5. `apps/vscode-extension/src/ui/` (The Disambiguation Layer)**
When the runtime detects ambiguity (e.g., user says *"go to the error handler"* and there are 4 matches), this module renders the visual handshake. 
*   It uses VS Code's `TextEditorDecorationType` API to paint temporary, audio-friendly labels ("Alpha", "Bravo") directly over the code.

---

### **Execution Roadmap for this Codebase (Phase 0 to MVP)**

If you are bootstrapping this repository today, follow the exact sequence outlined in the review:

*   **Week 1 (Setup & `protocol`)**: Initialize the Turborepo. Write the TypeScript interfaces for the top 20 intents (Locate, Open, Edit, Explain, Run).
*   **Week 2-3 (The `vscode-adapter`)**: Build the **Hot** and **Warm** snapshot tiers. Hook them up to a simple local WebSocket server (the `debug-dashboard`) just to prove you can map VS Code state into a live Semantic Graph in `<16ms`.
*   **Week 4 (`audio-pipeline`)**: Implement the push-to-talk or VAD audio stream. Hook it up to a fast Whisper endpoint (like Groq or local Whisper.cpp).
*   **Week 5-6 (`runtime` & Integration)**: Build the Intent Router prompt. Wire the audio pipeline to the router, feed it the VS Code adapter snapshot, and map the outputs back to `vscode.commands.executeCommand`.
*   **Week 7 (`disambiguation`)**: Implement the visual highlighting overlay for ambiguous commands.

By keeping the runtime and protocol completely isolated from the `vscode-extension` wrapper, your Phase 2 (Browser Adapter) will simply require writing a `browser/src/snapshot/dom.ts` file, reusing 80% of your existing codebase.