# USIR — Implementation Status & Next Steps

## Legend
- ✅ Done
- 🔜 Next up
- ⏳ Planned
- 🛠 In progress

---

## Phase 1: Foundation — Lock schemas and runtime skeleton

| Task | Status |
|------|--------|
| Define `@usir/protocol` package | ✅ |
| Define all 8 intent layers (L0–L8) plus L0.5 Provenance | ✅ |
| Define `CognitiveReference` (4 kinds) | ✅ |
| Set up monorepo: Turborepo + pnpm workspaces | ✅ |
| Set up `tsconfig.base.json` with strict mode | ✅ |
| Lint, typecheck, build pipeline | ✅ |

### Deliverables status
- [ ] Publish `@usir/protocol` to npm (0.1.0-alpha)
- [x] All TypeScript types compile cleanly
- [x] The 6-pillar master spec is in `docs/MASTER-SPEC.md`

---

## Phase 2: VS Code Adapter — Tiered snapshot engine

| Task | Status |
|------|--------|
| Build `SnapshotEngine` with Hot/Warm/Cold tiers | ✅ |
| Hook VS Code events | ✅ |
| Build `ToolRegistry` and 9 VS Code tools | ✅ |
| Build `BoundedFileSystem` walker | ✅ |
| Map VS Code Accessibility Tree to `SemanticEntity` | ✅ |
| Add provenance hooks in tool implementations | ✅ |

---

## Phase 3: Interaction Memory + Router

| Task | Status |
|------|--------|
| Build `InteractionMemory` | ✅ |
| Build `CognitiveReference` resolvers | ✅ |
| Build `LLMRouter` with JSON-output prompting | ✅ |
| Build prompt templates | ✅ |
| Wire Whisper STT (Groq / OpenAI) | ✅ |
| Build `FusedIntent` (linguistic + pointing + implicit) | ✅ |
| Build disambiguation Waypoint renderer | ✅ |

---

## Phase 4: Topological Executor + Agent Foundation

| Task | Status |
|------|--------|
| Build `TopologicalExecutor` (DAG execution) | ✅ |
| Build `ProvenanceStore` | ✅ |
| Build `TrustClassifier` (3-tier gate) | ✅ |
| Build `A2UDispatcher` | ✅ |
| Build 4 agent surfacing reasons | ✅ |
| Add `DelegateIntent` schema and constraints | ✅ |

---

## Phase 5: VS Code Extension MVP

| Task | Status |
|------|--------|
| Wire `extension.ts` to all subsystems | ✅ |
| Push-to-talk keybinding (`Ctrl+Shift+Space`) | ✅ |
| Status bar item + indicator | ✅ |
| Snapshot view webview | ✅ |
| Provenance view webview | ✅ |
| Settings: API keys, LLM endpoint | ✅ |
| Disambiguation Waypoint UI (HTML panel) | ✅ |
| Auto-update `InteractionMemory` from cursor focus | ✅ |

---

## Phase 6: Browser Adapter + Public Alpha (Next up)

| Task | Status | Notes |
|------|--------|-------|
| Build `@usir/browser-adapter` (DOM Accessibility Tree) | ✅ | Package created: Hot/Warm/Cold tiers, DOM adapter, 7 browser tools |
| Build Playwright-based zero-shot adapter prototype | ✅ | `@usir/playwright-adapter`: DOM extractor (injected eval), snapshot engine, 8 Playwright tools |
| Add Capability Registry — discover tools across adapters | ✅ | `AdapterCapabilityRegistry` in `@usir/runtime`: cross-adapter tool/role discovery |
| Public alpha on GitHub — invite 100 developers | ⏳ | |
| Open `docs/ontology/` for community proposals | ✅ | `docs/ontology/` directory with v1 spec and proposals folder |
| Write 1.0 candidate spec for Universal Intent Ontology | ✅ | `docs/ontology/universal-intent-ontology-v1.md` — full 8-layer spec |

---

## Cross-cutting improvements (before public alpha)

| Task | Status | Priority |
|------|--------|----------|
| Write tests (protocol, runtime, audio-pipeline) | ✅ | Critical |
| Fix build (`@types/node`, exports map, moduleResolution) | ✅ | Critical |
| Set up ESLint with typescript-eslint | ✅ | High |
| Fix `.gitignore` (uncomment dist/, .turbo/, coverage/) | ✅ | Medium |
| Surface all 6 blog parts in README | ✅ | Medium |
| Set up CI/CD (GitHub Actions) | 🔜 | Critical |
| Publish `@usir/protocol` to npm (0.1.0-alpha) | 🔜 | Critical |
| Test VS Code extension in actual editor | 🔜 | High |
| Add local Whisper.cpp fallback for offline mode | ⏳ | High |
| Add retry logic to `TopologicalExecutor` | ⏳ | Medium |
| Persist interaction memory (SQLite or JSON) | ⏳ | Medium |
| Set up npm packaging config (publishConfig, files whitelist) | ⏳ | Medium |
| Add `.nvmrc` and `.npmrc` | ⏳ | Low |

---

## Year 2: Federated Runtime

### Phase 1: Federation Protocol — Define `@usir/federation` package

| Task | Status |
|------|--------|
| 1a. Scaffold `packages/federation` with package.json, turbo config, tsconfig | ✅ |
| 1b. Define `FederationPeer` (identity, capabilities, address, trust level) | ✅ |
| 1c. Define `FederationMessage` types (offer, answer, ice, sync, intent, provenance) | ✅ |
| 1d. Define `FederationTopology` (star, mesh, hybrid) and peer connection state machine | ✅ |
| 1e. Define `FederatedSnapshot` — SemanticGraph diff/merge format for sync | ✅ |
| 1f. Define cross-runtime `ProvenanceAnchor` schema (links provenance across runtimes) | ✅ |

### Phase 2: Transport Layer — WebRTC signaling + data channels

| Task | Status |
|------|--------|
| 2a. Build `SignalingServer` class (in-memory MVP) | ✅ |
| 2b. Build `PeerConnectionManager` — WebRTC offer/answer/ICE lifecycle | ✅ |
| 2c. Build `DataChannelManager` — reliable/unordered channels for sync vs streaming | ✅ |
| 2d. Build `FederationTransport` interface (abstraction for WebRTC, later WS/HTTP) | ✅ |
| 2e. Handle reconnection, heartbeat (keepalive), graceful disconnect | ✅ |

### Phase 3: State Synchronization — Federated SemanticGraph with CRDT

| Task | Status |
|------|--------|
| 3a. Integrate Yjs CRDT for SemanticGraph node/edge sync | ✅ |
| 3b. Build `FederatedGraph` class — wraps Yjs Doc, maps SemanticGraph ↔ Y.Map/Y.Array | ✅ |
| 3c. Implement sync protocol — initial snapshot + incremental patches | ✅ |
| 3d. Handle merge conflicts (LWW per field, intent-aware reconciliation) | ✅ |
| 3e. Build `FederatedSnapshotEngine` — tiered snapshots from federated graph | ✅ |

### Phase 4: Peer Discovery & Capability Advertisement

| Task | Status |
|------|--------|
| 4a. Build `DiscoveryService` — LAN broadcast (mDNS) + signaling server registry | ⏳ |
| 4b. Build `CapabilityAdvertisement` — broadcast supported roles, tools, intents to peers | ⏳ |
| 4c. Extend `AdapterCapabilityRegistry` with remote peer capabilities | ⏳ |
| 4d. Build `PeerDirectory` — unified local + remote peer views | ⏳ |

### Phase 5: L8 Collaboration Intent Handlers

| Task | Status |
|------|--------|
| 5a. Build `ShareHandler` — push entities/snapshots to peers with permission | ⏳ |
| 5b. Build `DiscussHandler` — multi-peer annotation threads on entities | ⏳ |
| 5c. Build `AnnotateHandler` — attach L8 annotations to shared entities | ⏳ |
| 5d. Build `BroadcastHandler` — publish intent to N peers with ttl/scope | ⏳ |
| 5e. Wire L8 handlers into `TopologicalExecutor` as discoverable tools | ⏳ |
| 5f. Build multi-peer `InteractionMemory` — resolve conversational refs across peers | ⏳ |

### Phase 6: Cross-Runtime Provenance

| Task | Status |
|------|--------|
| 6a. Add `remoteProvenanceId` and `runtimeId` fields to `ProvenanceNode` | ⏳ |
| 6b. Build `ProvenanceBridge` — sync provenance sub-graphs between runtimes | ⏳ |
| 6c. Build cross-runtime causal chain walker (follow anchors across runtimes) | ⏳ |
| 6d. Build trust migration protocol — verify and chain approvals across runtimes | ⏳ |

### Phase 7: Federation Runtime — Orchestrator

| Task | Status |
|------|--------|
| 7a. Build `FederatedRuntime` class — state machine (idle → connecting → synced → connected) | ⏳ |
| 7b. Wire into `@usir/runtime` index.ts exports | ⏳ |
| 7c. Build `FederationConfig` (peer limits, sync throttle, trust policies) | ⏳ |
| 7d. Add telemetry/events for federation lifecycle | ⏳ |

### Phase 8: Integration & Testing

| Task | Status |
|------|--------|
| 8a. Unit tests for federation protocol types and message serialization | ⏳ |
| 8b. Unit tests for `PeerConnectionManager` (mock RTCPeerConnection) | ⏳ |
| 8c. Unit tests for `FederatedGraph` CRDT sync | ⏳ |
| 8d. Integration tests: two in-process `FederatedRuntime`s syncing graph | ⏳ |
| 8e. Integration tests: L8 intent dispatch across peers | ⏳ |
| 8f. Typecheck and lint pass on all new code | ⏳ |

### Phase 9: Documentation

| Task | Status |
|------|--------|
| 9a. Update `IMPLEMENTATION.md` with detailed federation status | ⏳ |
| 9b. Add `FEDERATION.md` — architecture, protocol, deployment guide | ⏳ |

---

## Year 3+: Capability Marketplace

| Task | Status |
|------|--------|
| Public capability registry | ⏳ |
| Trust score system | ⏳ |
| Pricing / invoicing | ⏳ |
| OS-level adapter (processes, files, windows) | ⏳ |
| IoT / XR adapters | ⏳ |

---

## Current metrics

| Metric | Value |
|--------|-------|
| TypeScript packages | 7 |
| Lines of implementation | ~5,200 |
| Tests | 100 (all passing) |
| Lint errors | 0 |
| Warnings | 26 (all `no-explicit-any` / `no-unused-vars`) |
| CI | Not configured |
| Published to npm | None |
