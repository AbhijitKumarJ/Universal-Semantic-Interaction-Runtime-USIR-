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
| 4a. Build `DiscoveryService` — signaling server registry + periodic presence broadcast | ✅ |
| 4b. Build `CapabilityAdvertisement` — broadcast supported roles, tools, intents to peers | ✅ |
| 4c. Build `RemoteCapabilityBridge` — interface for runtime adapter registry integration | ✅ |
| 4d. Build `PeerDirectory` — unified local + remote peer views with filters | ✅ |

### Phase 5: L8 Collaboration Intent Handlers

| Task | Status |
|------|--------|
| 5a. Build `ShareHandler` — push entities/snapshots to peers with permission | ✅ |
| 5b. Build `DiscussHandler` — multi-peer annotation threads on entities | ✅ |
| 5c. Build `AnnotateHandler` — attach L8 annotations to shared entities | ✅ |
| 5d. Build `BroadcastHandler` — publish intent to N peers with ttl/scope | ✅ |
| 5e. Build `L8ToolRegistry` — wraps handlers as `Tool`-compatible objects for `TopologicalExecutor` | ✅ |
| 5f. Build `MultiPeerMemory` — resolve conversational references across peers | ✅ |

### Phase 6: Cross-Runtime Provenance

| Task | Status |
|------|--------|
| 6a. Add `remoteProvenanceId`, `runtimeId`, `remoteRuntimeId` fields to `ProvenanceNode` (in `@usir/protocol`) | ✅ |
| 6b. Build `ProvenanceBridge` — sync provenance sub-graphs between runtimes via `federation.provenance` messages | ✅ |
| 6c. Build `CrossRuntimeCausalWalker` — follow provenance anchors across runtimes | ✅ |
| 6d. Build `TrustMigration` — verify trust chains, chain approvals across runtimes | ✅ |

### Phase 7: Federation Runtime — Orchestrator

| Task | Status |
|------|--------|
| 7a. Build `FederatedRuntime` class — state machine (idle → starting → connecting → synced → connected → stopping → stopped) | ✅ |
| 7b. Wire into `@usir/runtime` via `federation-bridge.ts` — registers L8 tools, connects peer events to `AdapterCapabilityRegistry` | ✅ |
| 7c. Build `FederationRuntimeConfig` + `createDefaultConfig()` (peer limits, sync throttle, trust policies, ICE servers) | ✅ |
| 7d. Add `FederationLifecycleEvent` system — state changes, peer connect/disconnect, graph updates, intent received, errors | ✅ |

### Phase 8: Integration & Testing

| Task | Status |
|------|--------|
| 8a. Unit tests for federation protocol types (peer, message, topology, snapshot, provenance) — 25 tests | ✅ |
| 8b. Unit tests for `PeerConnectionManager` (covered via integration test infrastructure) | ✅ |
| 8c. Unit tests for `FederatedGraph` CRDT sync — concurrent edits, Yjs update round-trip, observer events | ✅ |
| 8d. Integration tests: in-memory signaling, `FederatedGraph` sync, `DiscoveryService`, `ProvenanceBridge`, `CausalWalker`, `TrustMigration`, `MultiPeerMemory` | ✅ |
| 8e. Integration tests: `ShareHandler`, `DiscussHandler`, `AnnotateHandler`, `BroadcastHandler` dispatch | ✅ |
| 8f. Typecheck (0 errors) and lint (0 errors, 18 warnings) pass on all new code | ✅ |

### Phase 9: Documentation

| Task | Status |
|------|--------|
| 9a. Update `IMPLEMENTATION.md` with detailed federation status | ✅ |
| 9b. Add `FEDERATION.md` — architecture, protocol, deployment guide | ✅ |

---

## Year 3+: Capability Marketplace

### Phase 1: Public Capability Registry

| Task | Status |
|------|--------|
| 1a. Define capability registry data model (schema, categories, versioning, search indexing) | ✅ |
| 1b. Scaffold `@usir/registry` package — REST API server (Node http, publish/query/delete) | ✅ |
| 1c. Scaffold `@usir/registry-client` package — client SDK for adapters to register & discover capabilities | ✅ |
| 1d. Implement capability CRUD endpoints (POST publish, GET search, GET by ID, DELETE unpublish) | ✅ |
| 1e. Implement search / filter (by category, tags, intent type, trust score, text query, pagination) | ✅ |
| 1f. Implement capability verification — publisher identity, schema conformance, signature verification | ✅ |
| 1g. Build registry sync protocol — periodic refresh, delta updates, offline cache in `@usir/registry-client` | ✅ |
| 1h. Integrate capability resolution into `RemoteCapabilityBridge` — `queryRegistry()` + `setRegistryClient()` | ✅ |
| 1i. Add registry health / metrics endpoints (`/health`, `/stats`, `/publishers`) | ✅ |
| 1j. Write integration tests: 39 registry tests (store, verification, server HTTP) + 8 client tests | ✅ |

### Phase 2: Trust Score System

| Task | Status |
|------|--------|
| 2a. Define trust score data model — `TrustScore`, `TrustFactor`, `TrustDecayConfig`, `Attestation`, `AttestationAggregate`, `TrustScoreBreakdown` + weight constants | ✅ |
| 2b. Build `TrustEngine` — weighted factor scoring (base/verification/attestation/uptime/recency) with configurable weights | ✅ |
| 2c. Implement trust decay — exponential half-life decay (`applyDecay()`, default 30d half-life) | ✅ |
| 2d. Build `ReputationOracle` — attestation submission, expiry filter, aggregate computation, prune | ✅ |
| 2e. Integrate trust scores into `TrustMigration` — `minimumTrustScore` policy, `TrustScoreProvider` interface, `setTrustScore()`/`getTrustScore()` | ✅ |
| 2f. Build trust dashboard — `GET /trust` (all scores), `GET /trust/:id` (breakdown + attestations), `POST /trust/attest` (submit) | ✅ |
| 2g. Write tests: 6 trust-engine tests (scoring, verified boost, attestation incorporation, breakdown, decay, half-life), 6 oracle tests + 3 server endpoint tests = 15 tests | ✅ |

### Phase 3: Pricing & Invoicing

| Task | Status |
|------|--------|
| 3a. Define pricing data model — `RateCard`, `RateTier`, `UsageRecord`, `UsageAggregate`, `Invoice`, `InvoiceLine`, `Payout`, `CheckoutSession`, `PaymentProviderConfig`, `PaymentMethod` | ✅ |
| 3b. Build `UsageTracker` — record capability invocations, aggregate by capability/publisher/consumer within periods | ✅ |
| 3c. Build `PricingEngine` — rate cards (free/per-call/metered-tiered/subscription), compute invoice lines from usage × rate card | ✅ |
| 3d. Build `PaymentProvider` interface + `MockPaymentProvider` — checkout session creation, payment processing, refunds, payment methods. Hook points for Stripe/PayPal adapters | ✅ |
| 3e. Build `Invoicing` — generate invoices from usage, send, pay, mark overdue, create checkout sessions | ✅ |
| 3f. Build publisher payout system — `computePayout()` (aggregate earnings - 10% platform fee), `schedulePayout()`, `processPayout()` | ✅ |
| 3g. Tests: 5 usage-tracker, 5 pricing-engine, 8 invoicing = 18 tests | ✅ |
| 3h. Server endpoints: `POST/GET /usage`, `POST/GET /rate-cards`, `POST/GET /invoices`, `POST /invoices/:id/pay`, `POST/GET /checkout`, `POST/GET /payouts`, `POST /payouts/:id/schedule`, `POST /payouts/:id/process` | ✅ |

### Phase 4: OS-Level Adapter

| Task | Status |
|------|--------|
| 4a. Scaffold `@usir/adapters-os` package | ⏳ |
| 4b. Build Process adapter — spawn, list, signal, monitor (CPU/mem), kill processes | ⏳ |
| 4c. Build File System adapter — read/write, watch, search, metadata, permissions | ⏳ |
| 4d. Build Window manager adapter — list windows, focus, move/resize, minimize/restore | ⏳ |
| 4e. Build System adapter — host info, env vars, clipboard, notifications | ⏳ |
| 4f. Build Shell adapter — execute commands, pipe I/O, stream output | ⏳ |
| 4g. Ensure all adapters conform to `Tool` interface + capability advertisement schema | ⏳ |
| 4h. Write security sandbox — permission prompts, path allowlist, command allowlist | ⏳ |
| 4i. Write tests: process lifecycle, file operations, window queries, shell execution | ⏳ |

### Phase 5: IoT / XR Adapters

| Task | Status |
|------|--------|
| 5a. Scaffold `@usir/adapters-iot` package | ⏳ |
| 5b. Build MQTT adapter — publish, subscribe, bridge topics ↔ SemanticGraph entities | ⏳ |
| 5c. Build CoAP adapter — discover resources, observe, read/write attributes | ⏳ |
| 5d. Build Modbus / OPC-UA adapter (industrial IoT) — read registers, write coils, browse tags | ⏳ |
| 5e. Build Sensor fusion adapter — aggregate telemetry, threshold alerts, time-series queries | ⏳ |
| 5f. Scaffold `@usir/adapters-xr` package | ⏳ |
| 5g. Build Unity bridge adapter — send/receive spatial transforms, trigger XR events via NamedPipe/WS | ⏳ |
| 5h. Build Spatial anchor adapter — persist/query anchors, coordinate system transforms | ⏳ |
| 5i. Build XR input adapter — map hand/eye/gaze tracking to SemanticGraph entity interactions | ⏳ |
| 5j. Write tests: MQTT connect/pub/sub, CoAP resource discovery, XR spatial sync | ⏳ |

---

## Current metrics

| Metric | Value |
|--------|-------|
| TypeScript packages | 10 (+ `@usir/federation`, `@usir/registry`, `@usir/registry-client`) |
| Lines of implementation | ~11,500 (+ ~1,700 in pricing engine, usage tracker, invoicing, payment provider, server endpoints) |
| Tests | 242 (224 + 18 new pricing tests) |
| Lint errors | 0 |
| Warnings | 58 (44 pre-existing + 10 registry + 4 client; all `no-explicit-any` / `no-unused-vars`) |
| CI | Not configured |
| Published to npm | None |
