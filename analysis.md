# USIR — Repository Analysis
    
    Repository: Universal-Semantic-Interaction-Runtime (USIR)
    Analysis Date: 2026-06-02
    Maturity: Pre-alpha (Ideation phase complete, implementation skeleton in place)
    
    
    
    1. Project Overview
    
    USIR aims to create a semantic operating layer that decouples human intent from application implementation. Rather than forcing AI agents to interact through pixel-based GUIs (the "GUI trap"), it proposes a universal semantic protocol where applications expose meaning (entities, intents, relationships) instead of presentation (buttons, menus, coordinates).
    
    The project draws a direct analogy: just as TCP/IP abstracted byte transport and HTML abstracted document presentation, USIR aims to abstract interaction itself.
    
    Status: All core TypeScript types and runtime classes are implemented. The project compiles but has zero tests, zero CI, and has never been run in production. It is a well-architected skeleton awaiting flesh.
    
    
    
    2. Repository Structure
    
    
    USIR_REPO/                     # Primary implementation directory
    ├── packages/
    │   ├── protocol/              # @usir/protocol — Shared schemas/ontologies
    │   ├── runtime/               # @usir/runtime — Core execution engine
    │   └── audio-pipeline/        # @usir/audio-pipeline — Voice capture + STT
    ├── adapters/
    │   └── vscode/                # @usir/vscode-adapter — VS Code bridge
    ├── apps/
    │   └── vscode-extension/      # @usir/vscode-extension — Deployable extension
    ├── docs/
    │   ├── MASTER-SPEC.md         # Canonical architecture spec
    │   ├── ROADMAP.md             # 12-month plan
    │   ├── 01-the-gui-trap.md ... # "Beyond the GUI" 6-part blog series
    │   └── semantic-horizon/      # "Semantic Horizon" 5-part blog series
    ├── examples/
    │   └── bmad-wizard/           # Brainstorming wizard PoC (external)
    ├── Ideation/                  # 66-turn conversational design history
    ├── pnpm-workspace.yaml        # pnpm monorepo config
    ├── turbo.json                 # Turborepo build pipeline
    ├── tsconfig.base.json         # Shared TypeScript config (ES2022, strict)
    └── package.json               # Root monorepo config
    
    
    
    
    3. Architecture Breakdown
    
    3.1 Pillars
    
    Pillar: 1. Universal Intent Ontology
    What It Is: ~50 cognitive verbs across 8 layers (L0–L8) + L0.5 Provenance
    Where It Lives: packages/protocol/src/intents/
    Implementation Status: ✅ Full type definitions
    ────────────────────────────────────────
    Pillar: 2. Interaction Memory
    What It Is: Resolves "it", "that", "previous" via 4 reference types
    Where It Lives: packages/runtime/src/memory/
    Implementation Status: ✅ Functional implementation
    ────────────────────────────────────────
    Pillar: 3. Semantic Graph
    What It Is: Typed graph: nodes = entities, edges = relations
    Where It Lives: packages/protocol/src/graph/
    Implementation Status: ✅ With BFS traversal, role/source indices
    ────────────────────────────────────────
    Pillar: 4. Semantic Snapshot
    What It Is: 3-tier snapshot emitted by every adapter
    Where It Lives: packages/protocol/src/snapshot/
    Implementation Status: ✅ Hot/Warm/Cold fully typed
    ────────────────────────────────────────
    Pillar: 5. Deterministic Execution
    What It Is: LLM plans; runtime executes (DAG of steps)
    Where It Lives: packages/runtime/src/executor/ + router/
    Implementation Status: ✅ TopologicalExecutor, LLMRouter, prompts
    ────────────────────────────────────────
    Pillar: 6. Semantic Adapters
    What It Is: Bridge existing software to USIR
    Where It Lives: adapters/vscode/
    Implementation Status: ✅ VS Code adapter with 7 tools
    
    3.2 L0.5 Provenance Layer
    
    A key innovation from the project's review process. Tracks why mutations happened, not just what changed. Every provenance node records:
    - The intent + actor (user/agent/system)
    - The rationale (user-requested / delegated / inferred)
    - The authorization chain (approved / delegated / pending / rejected)
    - Causal parents + content hashes (SHA-256) for replay
    - Semantic diffs (field-level, not text diffs)
    
    Files: packages/protocol/src/provenance/index.ts, packages/runtime/src/provenance/provenance-store.ts
    
    3.3 A2U (Agent-to-USIR) Protocol
    
    A trust-based gate that keeps humans in control of autonomous agents via 3 trust tiers and 4 urgency levels (background/checkpoint/blocker/completion). Agents surface waypoints for approval when confidence is low or actions are irreversible.
    
    Files: packages/runtime/src/a2u/
    
    
    
    4. Package Deep Dive
    
    4.1 @usir/protocol — The Shared Language
    
    Zero runtime dependencies. Pure TypeScript type definitions and helpers.
    
    | Module      | Purpose                                                                                                         |
    |-------------|-----------------------------------------------------------------------------------------------------------------|
    | entities/   | SemanticEntity, EntityRole (28 roles), SpatialBounds (2D + 3D), AudioFingerprint                                |
    | intents/    | UniversalIntent union type (25 subtypes across L0–L8), IntentEnvelope, type guards                              |
    | graph/      | SemanticGraph with adjacency lists, role/source indices, BFS, findEntities                                      |
    | snapshot/   | SemanticSnapshot with Hot (16ms), Warm (150ms), Cold (seconds) tiers                                            |
    | memory/     | CognitiveReference (temporal/conversational/spatial/semantic)                                                   |
    | waypoint/   | InteractionWaypoint — multi-modal presentation primitive (display/audio/spatial/haptic/XR) with fallback chains |
    | provenance/ | ProvenanceNode, ProvenanceGraph, causal chain walker, SHA-256 entity hashing                                    |
    | capability/ | Forward-looking capability marketplace schemas (not yet used)                                                   |
    
    Notable: The Waypoint type is unusually thorough — it specifies not just display and audio, but also XR holographic buttons, haptic patterns, dial/watch inputs, and a 5-channel fallback chain (SMS, email, push, USB, QR, voice call).
    
    4.2 @usir/runtime — The Brain
    
    | Module                                 | Purpose                                                                            |
    |----------------------------------------|------------------------------------------------------------------------------------|
    | memory/interaction-memory              | Ring buffer of 50 recent entities; 4 reference resolvers; conversation history     |
    | router/llm-router                      | OpenAI-compatible LLM call → JSON ExecutionPlan; strips hot snapshot for prompt    |
    | router/types                           | ExecutionStep, ExecutionPlan, StepResult, ExecutionResult types                    |
    | router/prompts                         | System + user prompt templates; strict JSON-output instruction                     |
    | executor/topological-executor          | DAG executor — runs steps in dependency order, parallel ready steps, Promise.race  |
    | disambiguation/collaborative-narrowing | NATO phonetic names (Alpha–Zulu), waypoint builder, ambiguity→waypoint converter   |
    | provenance/provenance-store            | In-memory provenance graph; record, explainHistory, approve/reject                 |
    | a2u/trust-classifier                   | 3-tier gate: read-only auto, reversible on confidence, irreversible always approve |
    | a2u/dispatcher                         | Routes A2U envelopes; immediate execution, queue, checkpoint, blocker waypoints    |
    
    Architectural insight: The LLM Router is the only component that calls an LLM. Everything else is deterministic TypeScript. This is a deliberate safety boundary.
    
    4.3 @usir/audio-pipeline — Voice Input
    
    | Module         | Purpose                                                                                       |
    |----------------|-----------------------------------------------------------------------------------------------|
    | vad            | Energy-based Voice Activity Detection (configurable threshold, silence duration)              |
    | whisper-client | Groq Whisper STT (fastest endpoint) + mock client for testing                                 |
    | audio-capture  | Web Audio API → VAD → STT pipeline; 16kHz, Float32→16-bit PCM conversion                      |
    | fused-intent   | PointingTarget + ImplicitSignals (typing cadence, gaze, affective markers) + linguistic input |
    
    4.4 @usir/vscode-adapter — VS Code Bridge
    
    | Module                 | Purpose                                                                                                                    |
    |------------------------|----------------------------------------------------------------------------------------------------------------------------|
    | snapshot/engine        | Orchestrates Hot/Warm/Cold tiers with version bump                                                                         |
    | snapshot/hot           | Cursor, selection, pointer tracking (16ms debounce)                                                                        |
    | snapshot/warm          | Visible entities, recent changes, panel layout (150ms debounce)                                                            |
    | snapshot/cold          | Full SemanticGraph with LSP metadata (1s debounce)                                                                         |
    | registry/tool-registry | Re-exports ToolRegistry from runtime                                                                                       |
    | registry/vscode-tools  | 7 tools: openEntity, focusRegion, editEntity, executeCommand, runTests, runInTerminal, search, locateSymbol, applyRefactor |
    
    4.5 @usir/vscode-extension — The MVP App
    
    - Activation hooks all 6 subsystems together
    - Registers 4 commands: start/stop/listening, showSnapshot, showProvenance
    - Keybinding: Ctrl+Shift+Space / Cmd+Shift+Space
    - Status bar item with mic icon
    - Settings: OpenAI API key, Groq API key, LLM endpoint/model
    - Hot-tied event listeners: editor change, selection change, document change, window focus
    - Pipeline: AudioCapture → FusedIntent → InteractionMemory → LLMRouter → TopologicalExecutor → results in notifications
    
    
    
    5. Philosophical Documents
    
    "Beyond the GUI" (6 parts, 1 written)
    docs/01-the-gui-trap.md — The flagship essay. Argues that GUI-based AI interaction (screenshots, DOM scraping, pixel coordinates) is fundamentally broken. Proposes USIR as the TCP/IP of interaction.
    
    docs/02-the-universal-protocol.md through 06-ambient-computing.md — Not yet written. Placeholder structure exists.
    
    "Semantic Horizon" (5 parts, all written)
    Forward-looking expansions:
    - Zero-Shot Adapter (VLM as compiler for apps without semantic APIs)
    - Ambient Sensorium (audio, gaze, biometrics as input surfaces)
    - Proactive Computing (runtime anticipates intent)
    - Agentic Delegation (trust protocols, sandboxes, checkpoints)
    - Federated Semantic Web (P2P runtime federation)
    
    MASTER-SPEC.md
    The canonical spec — 250 lines covering all 6 pillars, L0.5 provenance, A2U protocol, capability marketplace, and MVP scope.
    
    ROADMAP.md
    12-month plan with explicit caveat: "This timeline is optimistic." All Phase 1–5 tasks are marked [x] (completed). Phase 6 (browser adapter, public alpha) is open. Year 2–3 are speculative.
    
    
    
    6. Code Quality Assessment
    
    Strengths
    1. Deeply thought-through type system — SemanticEntity, InteractionWaypoint, and ProvenanceNode are genuinely well-designed. The 3-tier snapshot and 4-kind cognitive references show real architectural maturity.
    2. Safety-first design — LLMs only plan; runtime executes. A2U trust tiers, mandatory provenance, UNRESOLVED sentinel args, topological DAG execution.
    3. Multi-modal from day one — Waypoints carry display, audio (TTS + SSML), spatial (XR), haptic, gesture, dial, and 5 fallback channels.
    4. Monorepo hygiene — Turborepo, pnpm workspaces, strict TypeScript, ES2022 target, clean module boundaries.
    5. Philosophical grounding — The GUI Trap essay and MASTER-SPEC are well-written and make a compelling case.
    
    Weaknesses
    1. Zero tests — Every package has "test": "echo 'no tests yet'". No unit, integration, or E2E tests. This is the single biggest risk.
    2. No CI/CD — No GitHub Actions, no linting pipeline, no build verification beyond local tsc.
    3. No package publication — No npm publishing config. The protocol package should be published early for community feedback per the roadmap.
    4. Incomplete blog series — Parts 2–6 of "Beyond the GUI" are empty placeholders. This is the project's public face.
    5. VS Code extension untested — The activation pipeline (extension.ts) wires real subsystems together but has never been run in a VS Code instance. The audio pipeline depends on Web Audio API (renderer process) — may not work in VS Code's extension host.
    6. No local Whisper fallback — The MVP depends entirely on Groq's API. No offline mode.
    7. No error recovery strategy — The TopologicalExecutor aborts on first failure (non-optional steps). No retry, no circuit breaker, no graceful degradation.
    8. Interaction Memory is single-user — InteractionMemory takes a userId but there's no multi-user or session persistence beyond in-memory.
    
    Notable Missing Features (Relative to Roadmap)
    - Browser adapter — Planned for Month 11–12, not started
    - Zero-shot adapter — VLM-based fallback, documented in semantic-horizon, not implemented
    - Federated runtime — Year 2, deferred
    - Capability marketplace — Year 3+, types defined, not implemented
    - Community RFC process — Planned for Month 11, not started
    
    
    
    7. Line of Code Summary
    
    | Directory                    | Files | Approx. LOC | Description                               |
    |------------------------------|-------|-------------|-------------------------------------------|
    | packages/protocol/src/       | 10    | ~1,100      | Shared types, helpers                     |
    | packages/runtime/src/        | 9     | ~1,100      | Router, executor, memory, provenance, A2U |
    | packages/audio-pipeline/src/ | 5     | ~400        | VAD, STT, capture, fused intent           |
    | adapters/vscode/src/         | 7     | ~600        | Snapshot tiers, tools                     |
    | apps/vscode-extension/src/   | 1     | ~425        | Extension entry point                     |
    | docs/                        | ~12   | ~5,500      | Spec, roadmap, essays                     |
    | Ideation/                    | ~70   | ~50,000+    | Conversational design history             |
    | Total (implementation)       | 32    | ~3,600      | TypeScript source                         |
    | Total (documentation)        | 82    | ~55,000+    | Design docs + ideation                    |
    
    The signal-to-noise ratio is unusual: ~55K words of design documentation vs ~3.6K lines of executable code. The ideation folder alone is ~50K lines of conversational LLM output, which is valuable for traceability but inflates the project footprint.
    
    
    
    8. Git History
    
    - Single commit: the entire codebase appears to have been added in one shot
    - Minimal .gitignore — doesn't exclude dist/, node_modules/
    - No branches, tags, or PR history
    
    
    
    9. Risks & Recommendations
    
    Critical
    1. Write tests immediately — Every echo 'no tests yet' is a ticking time bomb. Start with protocol type validation, then runtime unit tests, then integration tests.
    2. Set up CI — GitHub Actions with pnpm install && pnpm typecheck && pnpm test as a bare minimum.
    3. Publish @usir/protocol — Even as a 0.1.0-alpha, getting the schemas in front of the community is worth more than polish.
    
    High
    4. Complete the blog series — Parts 2–6 of "Beyond the GUI" are the project's best marketing asset. Stub them out or drop them from the README.
    5. Add a local Whisper.cpp fallback — The MVP is non-functional offline. This is a hard blocker for developer adoption.
    6. Test the VS Code extension activation — The Web Audio API dependency may fail in the VS Code extension host (it runs in an extension host process, not a browser renderer). Verify before the next milestone.
    
    Medium
    7. Add retry logic to the executor — At minimum, a configurable number of retries for transient failures.
    8. Persist interaction memory — SQLite or simple JSON file per session.
    9. Set up npm packaging config — publishConfig, files whitelist, README for each package.
    10. Improve .gitignore — Add dist/, node_modules/, *.vsix, .turbo/.
    
    
    
    10. Final Verdict
    
    USIR is a exceptionally well-designed architecture with a compelling thesis and a concrete MVP strategy (VS Code extension as Trojan horse). The type system is thoughtful, the provenance layer is genuinely innovative, and the A2U trust protocol shows real understanding of agent safety challenges.
    
    However, it is currently a blueprint with a skeleton — 3,600 lines of TypeScript, zero tests, zero CI, zero runtime validation. The next logical step is to tighten the feedback loop: write tests, set up CI, and get the VS Code extension running in an actual editor. The architecture deserves execution.
    
    The ratio of design docs (~55K words) to working code (~3.6K lines) suggests the project may benefit from a focused "ship the MVP" phase — stop designing, start testing and running.

