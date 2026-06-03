# USIR — Repository Analysis

Repository: Universal-Semantic-Interaction-Runtime (USIR)
Analysis Date: 2026-06-03
Maturity: Pre-alpha (Phase 1–9 of Year 1–2 complete, Year 3+ Phases 1–5 complete)

## 1. Project Overview

USIR aims to create a semantic operating layer that decouples human intent from application implementation. Rather than forcing AI agents to interact through pixel-based GUIs (the "GUI trap"), it proposes a universal semantic protocol where applications expose meaning (entities, intents, relationships) instead of presentation (buttons, menus, coordinates).

The project draws a direct analogy: just as TCP/IP abstracted byte transport and HTML abstracted document presentation, USIR aims to abstract interaction itself.

Status: 12 TypeScript packages, ~17,000 lines of implementation, 501 tests, 0 lint errors. The runtime, federated P2P layer, capability marketplace, and all adapters (VS Code, browser, Playwright, OS, IoT, XR) are fully implemented with test coverage. The VS Code extension MVP is scaffolded but untested in a real editor.

## 2. Repository Structure

```
USIR_REPO/
├── packages/                   # Core packages (@usir/*)
│   ├── protocol/               # Shared schemas, ontologies, entity types
│   ├── runtime/                # Core engine: memory, router, executor, A2U, provenance
│   ├── audio-pipeline/         # Voice capture + STT pipeline
│   ├── federation/             # P2P WebRTC federation, CRDT sync, L8 collaboration
│   ├── registry/               # Capability marketplace REST API
│   ├── registry-client/        # Registry client SDK
│   ├── adapters-os/            # OS-level adapters (process, filesystem, window, shell)
│   ├── adapters-iot/           # IoT adapters (MQTT, CoAP, Modbus, sensor fusion)
│   └── adapters-xr/            # XR adapters (Unity bridge, spatial anchors, XR input)
├── adapters/
│   ├── vscode/                 # VS Code adapter (tiered snapshots + tools)
│   ├── browser/                # Browser DOM adapter (accessibility tree)
│   └── playwright/             # Playwright zero-shot adapter
├── apps/
│   └── vscode-extension/       # Deployable VS Code extension (MVP)
├── docs/
│   ├── MASTER-SPEC.md          # Canonical architecture spec
│   ├── FEDERATION.md           # P2P federation architecture guide
│   ├── IMPLEMENTATION.md       # Phase-by-phase status tracker
│   ├── ROADMAP.md              # 12-month plan
│   ├── 01-the-gui-trap.md      # "Beyond the GUI" Part 1
│   ├── 02-the-universal-protocol.md
│   ├── 03-the-adapter-layer.md
│   ├── 04-the-runtime.md
│   ├── 05-collaborative-narrowing.md
│   ├── 06-ambient-computing.md  # (6-part blog series, all written)
│   └── semantic-horizon/       # "Semantic Horizon" 5-part blog series
├── ontology/
│   └── universal-intent-ontology-v1.md  # 1.0 candidate spec
├── examples/
│   └── bmad-wizard/            # Brainstorming wizard PoC
├── Ideation/                   # 66-turn conversational design history
├── pnpm-workspace.yaml         # pnpm monorepo config
├── turbo.json                  # Turborepo build pipeline
├── tsconfig.base.json          # Shared TypeScript config (ES2022, strict)
└── package.json                # Root monorepo config
```

## 3. Architecture Breakdown

### 3.1 Pillars

| Pillar | What It Is | Where It Lives | Implementation Status |
|--------|-----------|----------------|----------------------|
| 1. Universal Intent Ontology | ~50 cognitive verbs across 8 layers (L0–L8) + L0.5 Provenance | packages/protocol/src/intents/ | ✅ Full type definitions |
| 2. Interaction Memory | Resolves "it", "that", "previous" via 4 reference types | packages/runtime/src/memory/ | ✅ Functional implementation |
| 3. Semantic Graph | Typed graph: nodes = entities, edges = relations | packages/protocol/src/graph/ | ✅ With BFS traversal, role/source indices |
| 4. Semantic Snapshot | 3-tier snapshot emitted by every adapter | packages/protocol/src/snapshot/ | ✅ Hot/Warm/Cold fully typed |
| 5. Deterministic Execution | LLM plans; runtime executes (DAG of steps) | packages/runtime/src/executor/ + router/ | ✅ TopologicalExecutor, LLMRouter, prompts |
| 6. Semantic Adapters | Bridge existing software to USIR | adapters/ + packages/adapters-*/ | ✅ 9 adapter packages (VS Code, browser, Playwright, OS, IoT, XR) |

### 3.2 L0.5 Provenance Layer

A key innovation. Tracks why mutations happened, not just what changed. Every provenance node records:
- The intent + actor (user/agent/system)
- The rationale (user-requested / delegated / inferred)
- The authorization chain (approved / delegated / pending / rejected)
- Causal parents + content hashes (SHA-256) for replay
- Semantic diffs (field-level, not text diffs)

Cross-runtime variant: `ProvenanceBridge` syncs provenance sub-graphs between runtimes via `federation.provenance` messages. `CrossRuntimeCausalWalker` follows provenance anchors across runtimes.

Files: `packages/protocol/src/provenance/`, `packages/runtime/src/provenance/`, `packages/federation/src/provenance-bridge/`

### 3.3 A2U (Agent-to-USIR) Protocol

A trust-based gate that keeps humans in control of autonomous agents via 3 trust tiers and 4 urgency levels (background/checkpoint/blocker/completion). Agents surface waypoints for approval when confidence is low or actions are irreversible.

Files: `packages/runtime/src/a2u/`

### 3.4 Federated Runtime

P2P runtime federation enabling multi-runtime collaboration:
- **WebRTC** signaling + data channels (`PeerConnectionManager`, `DataChannelManager`)
- **Yjs CRDT** for conflict-free SemanticGraph sync (`FederatedGraph`)
- **L8 Collaboration** handlers: Share, Discuss, Annotate, Broadcast
- **Discovery**: `DiscoveryService` (signaling + presence broadcast), `CapabilityAdvertisement`, `PeerDirectory`
- **FederatedRuntime** state machine: idle → starting → connecting → synced → connected

Files: `packages/federation/` (~4,760 LOC, 62 tests)

### 3.5 Capability Marketplace

Public registry for publishing, discovering, and monetizing capabilities:
- **Registry**: CRUD REST API, search/filter/pagination, publisher identity verification, signature verification
- **Trust**: Weighted factor scoring (base/verification/attestation/uptime/recency) with exponential half-life decay
- **Pricing**: Rate cards (free/per-call/metered-tiered/subscription), usage tracking, invoicing, payout system
- **Registry Client**: HTTP client, local cache with staleness tracking, periodic sync protocol

Files: `packages/registry/`, `packages/registry-client/` (~2,880 LOC, 80 tests)

### 3.6 Adapter Ecosystem

| Adapter | Package | Tools | Tests |
|---------|---------|-------|-------|
| VS Code | `@usir/vscode-adapter` | 9 (openEntity, focusRegion, editEntity, etc.) | 65 |
| Browser DOM | `@usir/browser-adapter` | 7 (navigate, click, extract, screenshot, etc.) | 68 |
| Playwright | `@usir/playwright-adapter` | 8 (navigate, click, type, extract, screenshot, etc.) | 7 |
| OS | `@usir/adapters-os` | 20+ (process, fs, window, shell, system) | 30 |
| IoT | `@usir/adapters-iot` | 25+ (MQTT pub/sub, CoAP, Modbus, sensor fusion) | 33 |
| XR | `@usir/adapters-xr` | 15 (Unity bridge, spatial anchors, XR input) | 20 |

## 4. Package Deep Dive

### 4.1 @usir/protocol — The Shared Language (~2,000 LOC, 41 tests, + `Storage` interface)

Zero runtime dependencies. Pure TypeScript type definitions and helpers.

| Module | Purpose |
|--------|---------|
| entities/ | SemanticEntity, EntityRole (28 roles), SpatialBounds (2D + 3D), AudioFingerprint |
| intents/ | UniversalIntent union type (25 subtypes across L0–L8), IntentEnvelope, type guards |
| graph/ | SemanticGraph with adjacency lists, role/source indices, BFS, findEntities |
| snapshot/ | SemanticSnapshot with Hot (16ms), Warm (150ms), Cold (seconds) tiers |
| memory/ | CognitiveReference (temporal/conversational/spatial/semantic) |
| waypoint/ | InteractionWaypoint — multi-modal presentation primitive (display/audio/spatial/haptic/XR) with fallback chains |
| provenance/ | ProvenanceNode, ProvenanceGraph, causal chain walker, SHA-256 entity hashing |
| capability/ | Registry, trust, and pricing data models for the capability marketplace |
| storage/ | `Storage` interface — `save<T>(path, data)` / `load<T>(path)`, implemented by `JsonFileStorage` and optional `SqliteStorage` |

Notable: The Waypoint type is unusually thorough — it specifies not just display and audio, but also XR holographic buttons, haptic patterns, dial/watch inputs, and a 5-channel fallback chain (SMS, email, push, USB, QR, voice call).

### 4.2 @usir/runtime — The Brain (~2,200 LOC, 60 tests)

| Module | Purpose |
|--------|---------|
| memory/interaction-memory | Ring buffer of 50 recent entities; 4 reference resolvers; conversation history |
| router/llm-router | OpenAI-compatible LLM call → JSON ExecutionPlan; strips hot snapshot for prompt |
| router/types | ExecutionStep, ExecutionPlan, StepResult, ExecutionResult types |
| router/prompts | System + user prompt templates; strict JSON-output instruction |
| executor/circuit-breaker | Per-tool circuit breaker: CLOSED/OPEN/HALF_OPEN states, configurable threshold + cooldown |
| executor/topological-executor | DAG executor — retry with exponential backoff + jitter, per-tool circuit breaker integration, `StepResult.retryCount` / `.circuitBreakerTripped` |
| persist/ | `JsonFileStorage` (zero-dep default), `SqliteStorage` (opt-in `better-sqlite3`), `Persistable<T>` interface |
| disambiguation/collaborative-narrowing | NATO phonetic names (Alpha–Zulu), waypoint builder, ambiguity→waypoint converter |
| provenance/provenance-store | In-memory provenance graph; record, explainHistory, approve/reject; `Persistable` with `Storage` injection |
| a2u/trust-classifier | 3-tier gate: read-only auto, reversible on confidence, irreversible always approve |
| a2u/dispatcher | Routes A2U envelopes; immediate execution, queue, checkpoint, blocker waypoints |

Architectural insight: The LLM Router is the only component that calls an LLM. Everything else is deterministic TypeScript. This is a deliberate safety boundary.

### 4.3 @usir/audio-pipeline — Voice Input (~480 LOC, 10 tests)

| Module | Purpose |
|--------|---------|
| vad | Energy-based Voice Activity Detection (configurable threshold, silence duration) |
| whisper-client | Groq Whisper STT (fastest endpoint) + mock client for testing |
| audio-capture | Web Audio API → VAD → STT pipeline; 16kHz, Float32→16-bit PCM conversion |
| fused-intent | PointingTarget + ImplicitSignals (typing cadence, gaze, affective markers) + linguistic input |

### 4.4 @usir/federation — P2P Runtime Federation (~4,760 LOC, 62 tests)

| Module | Purpose |
|--------|---------|
| peers/ | FederationPeer, FederationMessage types, topology, peer connection FSM |
| transport/ | SignalingServer, PeerConnectionManager (WebRTC), DataChannelManager, FederationTransport interface |
| sync/ | FederatedGraph (Yjs CRDT wrapper), sync protocol, merge reconciliation |
| discovery/ | DiscoveryService, CapabilityAdvertisement, RemoteCapabilityBridge, PeerDirectory |
| collaboration/ | ShareHandler, DiscussHandler, AnnotateHandler, BroadcastHandler, L8ToolRegistry, MultiPeerMemory |
| provenance-bridge/ | ProvenanceBridge, CrossRuntimeCausalWalker, TrustMigration |
| federation-runtime/ | FederatedRuntime state machine, bridge integration, config, lifecycle events |

### 4.5 @usir/registry — Capability Marketplace API (~2,440 LOC, 72 tests)

| Module | Purpose |
|--------|---------|
| registry-store/ | In-memory CRUD with category/tag/intent indexes, text search, pagination |
| registry-server/ | Node http server: POST/GET/DELETE /capabilities, /health, /stats, /publishers |
| verification/ | Schema conformance, publisher identity, signature verification |
| trust-engine/ | Weighted factor scoring with configurable weights and exponential half-life decay |
| reputation-oracle/ | Attestation submission, expiry, aggregation, pruning |
| usage-tracker/ | Record capability invocations, aggregate by period |
| pricing-engine/ | Rate cards: free, per-call, metered-tiered, subscription |
| invoicing/ | Invoice generation, payment processing, checkout sessions, payouts, overdue tracking |
| payment-provider/ | PaymentProvider interface + MockPaymentProvider |

### 4.6 @usir/registry-client — Client SDK (~440 LOC, 8 tests)

| Module | Purpose |
|--------|---------|
| registry-client/ | HTTP client for all registry endpoints |
| local-capability-cache/ | In-memory cache with staleness tracking |
| sync-protocol/ | Periodic refresh with configurable interval |

### 4.7 @usir/adapters-os — OS Adapters (~990 LOC, 30 tests)

Process (spawn/list/signal/monitor/kill), FileSystem (read/write/list/stat/search), Window (list/focus/resize/minimize/restore), Shell (exec + pipe), System (host info, env, clipboard, notifications). SecuritySandbox: path allowlists, command denylist, permission cache, grant/deny/reset.

### 4.8 @usir/adapters-iot — IoT Adapters (~1,080 LOC, 33 tests)

MQTT (connect/pub/sub/unsub/listMessages/bridgeTopic + wildcard matching), CoAP (discover/GET/PUT/POST/DELETE/observe), Modbus/OPC-UA (coils, registers, tag browsing), Sensor Fusion (ingest/query/aggregate/threshold alerts).

### 4.9 @usir/adapters-xr — XR Adapters (~710 LOC, 20 tests)

Unity Bridge (connect/disconnect/sendTransform/receiveTransforms/triggerEvent/pollEvents), Spatial Anchors (create/query/delete/transformBetween), XR Input (handTracking/eyeGaze/pollInteractions/mapEntity/unmapEntity).

### 4.10 @usir/vscode-adapter — VS Code Bridge (~560 LOC)

| Module | Purpose |
|--------|---------|
| snapshot/engine | Orchestrates Hot/Warm/Cold tiers with version bump |
| snapshot/hot | Cursor, selection, pointer tracking (16ms debounce) |
| snapshot/warm | Visible entities, recent changes, panel layout (150ms debounce) |
| snapshot/cold | Full SemanticGraph with LSP metadata (1s debounce) |
| registry/tool-registry | Re-exports ToolRegistry from runtime |
| registry/vscode-tools | 7 tools: openEntity, focusRegion, editEntity, executeCommand, runTests, runInTerminal, search, locateSymbol, applyRefactor |

### 4.11 @usir/vscode-extension — The MVP App

- Activation hooks all 6 subsystems together
- Registers 4 commands: start/stop/listening, showSnapshot, showProvenance
- Keybinding: Ctrl+Shift+Space / Cmd+Shift+Space
- Status bar item with mic icon
- Settings: OpenAI API key, Groq API key, LLM endpoint/model
- Hot-tied event listeners: editor change, selection change, document change, window focus
- Pipeline: AudioCapture → FusedIntent → InteractionMemory → LLMRouter → TopologicalExecutor → results in notifications

## 5. Philosophical Documents

**"Beyond the GUI" (6 parts, all written)**
`docs/01-the-gui-trap.md` — The flagship essay. Argues that GUI-based AI interaction (screenshots, DOM scraping, pixel coordinates) is fundamentally broken. Proposes USIR as the TCP/IP of interaction.

`docs/02-the-universal-protocol.md` through `06-ambient-computing.md` — All fully written with substantive content (~6-9KB each).

**"Semantic Horizon" (5 parts, all written)**
Forward-looking expansions: Zero-Shot Adapter (VLM as compiler), Ambient Sensorium (audio, gaze, biometrics), Proactive Computing (runtime anticipates intent), Agentic Delegation (trust protocols), Federated Semantic Web (P2P).

**MASTER-SPEC.md** — The canonical spec covering all 6 pillars, L0.5 provenance, A2U protocol, capability marketplace, and MVP scope.

**FEDERATION.md** — Comprehensive architecture, protocol, and deployment guide for the P2P federated runtime.

## 6. Code Quality Assessment

### Strengths

1. **Deeply thought-through type system** — SemanticEntity, InteractionWaypoint, and ProvenanceNode are genuinely well-designed. The 3-tier snapshot and 4-kind cognitive references show real architectural maturity.
2. **Safety-first design** — LLMs only plan; runtime executes. A2U trust tiers, mandatory provenance, UNRESOLVED sentinel args, topological DAG execution.
3. **Multi-modal from day one** — Waypoints carry display, audio (TTS + SSML), spatial (XR), haptic, gesture, dial, and 5 fallback channels.
4. **Monorepo hygiene** — Turborepo, pnpm workspaces, strict TypeScript, ES2022 target, clean module boundaries.
5. **Philosophical grounding** — The GUI Trap essay and MASTER-SPEC are well-written and make a compelling case.
6. **Comprehensive test coverage** — 501 tests across all 12 packages with 0 lint errors. The federation, registry, browser-adapter, and vscode-adapter packages each have 65–73 tests covering their domains.
7. **Incremental git history** — 20+ commits with clear phase boundaries (Year 1 Foundation → Year 2 Federation → Year 3+ Marketplace).

### Weaknesses

1. **No CI/CD** — No GitHub Actions, no automated lint/test/build verification on push.
2. **No package publication** — No npm publishing config. The protocol package should be published early for community feedback.
3. **VS Code extension untested in real editor** — The activation pipeline (extension.ts) wires real subsystems together but has never been run in a live VS Code instance. (Audio capture now uses hidden webview bridge, fixing the extension host compatibility issue.)
4. **Interaction Memory is single-user** — InteractionMemory takes a userId but there's no multi-user or session persistence beyond in-memory.
5. **Playwright DOM extractor uses injected script** — The `DOM_EXTRACTOR_SCRIPT` runs via `page.evaluate()`; complex SPAs may cause serialization bloat despite the TreeWalker fix.

### Notable Missing Features (Relative to Roadmap)

- CI/CD pipeline — Not configured
- npm publication — Not started
- Multi-user/multi-session support — Not started
- Audio fingerprint (sound matching, speaker diarization) — Not started
- XR adapter testing in real Unity editor — Not started

## 7. Line of Code Summary

| Directory | Files | Approx. LOC | Description |
|-----------|-------|-------------|-------------|
| packages/protocol/src/ | 10+ | ~2,000 | Shared types, helpers |
| packages/runtime/src/ | 10 | ~2,200 | Router, executor, circuit-breaker, persist, memory, provenance, A2U |
| packages/audio-pipeline/src/ | 5 | ~480 | VAD, STT, capture, fused intent |
| packages/federation/src/ | 30+ | ~4,760 | P2P WebRTC, CRDT, L8, provenance bridge |
| packages/registry/src/ | 10 | ~2,440 | REST API, trust, pricing, invoicing |
| packages/registry-client/src/ | 3 | ~440 | Client SDK, cache, sync |
| packages/adapters-os/src/ | 10 | ~990 | Process, fs, window, shell, system |
| packages/adapters-iot/src/ | 8 | ~1,080 | MQTT, CoAP, Modbus, sensor fusion |
| packages/adapters-xr/src/ | 7 | ~710 | Unity bridge, anchors, XR input |
| adapters/vscode/src/ | 7 | ~560 | Snapshot tiers, tools |
| adapters/browser/src/ | 5 | ~490 | DOM adapter, tools |
| adapters/playwright/src/ | 5 | ~470 | DOM extractor (TreeWalker-based), snapshot engine, tools |
| apps/vscode-extension/src/ | 1 | ~420 | Extension entry point |
| **Total (implementation)** | **~100** | **~17,000** | TypeScript source |
| docs/ + ontology/ | ~15 | ~3,800 | Spec, roadmap, essays |
| Ideation/ | ~70 | ~50,000+ | Conversational design history |

## 8. Git History

- 20+ commits with clear phase structure: Foundation → Audio → VS Code Extension → Browser Adapter → Federated Runtime (Phases 1–9) → Capability Marketplace (Phases 1–5)
- Phase boundaries are clearly delineated in commit messages
- Single-branch development (no feature branches)
- `IMPLEMENTATION.md` tracks phase-by-phase status

## 9. Risks & Recommendations

### Critical

1. **Set up CI** — GitHub Actions with `pnpm install && pnpm typecheck && pnpm -r lint && pnpm -r test` as a bare minimum. 501 existing tests provide meaningful regression protection.
2. **Publish @usir/protocol** — Even as a 0.1.0-alpha, getting the schemas in front of the community is worth more than polish.

### High

3. **Test the VS Code extension activation** — The activation pipeline (extension.ts) has never been run in a live VS Code instance. Audio capture now uses a hidden webview bridge, which should resolve the extension host compatibility issue — needs validation.
4. **Surface the blog series** — All 6 parts are written; ensure all are linked from the root README.

### Medium

5. **Set up npm packaging config** — publishConfig, files whitelist, README for each package.
6. **Multi-user session support** — InteractionMemory is single-user; needs session isolation for multi-tenant deployments.
7. **Add integration tests for Playwright adapter** — The `DOM_EXTRACTOR_SCRIPT` is tested via `parseDomResult` unit tests but not against real browser pages.

## 10. Final Verdict

USIR is an exceptionally well-designed architecture with a compelling thesis, a concrete MVP strategy (VS Code extension as Trojan horse), and substantial implementation progress. The type system is thoughtful, the provenance layer is genuinely innovative, and the A2U trust protocol shows real understanding of agent safety challenges.

The project has grown from a 3,600-line skeleton to a ~17,000-line implementation covering the core runtime, federated P2P layer, capability marketplace, and 6 adapter ecosystems. 501 tests provide meaningful coverage with 0 lint errors. Recent additions include: retry+circuit breaker for error resilience, dual JSON/SQLite persistence, TreeWalker-based DOM extraction for SPA scalability, and 133 new adapter tests.

The next logical steps are: CI/CD pipeline, npm publication for community feedback, testing the VS Code extension in a real editor, and multi-user session persistence. The architecture deserves execution — and it now has enough implementation mass to attract real contributors.
