# USIR — Implementation Status & Next Steps

## Legend
- ✅ Done
- 🔜 Next up
- ⏳ Planned

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
| Build `@usir/browser-adapter` (DOM Accessibility Tree) | ⏳ | Phase 6 milestone |
| Build Playwright-based zero-shot adapter prototype | ⏳ | VLM fallback for apps without semantic APIs |
| Add Capability Registry — discover tools across adapters | ⏳ | |
| Public alpha on GitHub — invite 100 developers | ⏳ | |
| Open `docs/ontology/` for community proposals | ⏳ | |
| Write 1.0 candidate spec for Universal Intent Ontology | ⏳ | |

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

| Task | Status |
|------|--------|
| Federated `SemanticGraph` over WebRTC (P2P) | ⏳ |
| L8 Collaboration Intents (share, discuss, annotate) | ⏳ |
| Provenance chains across multiple runtimes | ⏳ |
| `USIR Cloud` hosted runtime | ⏳ |

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
| TypeScript packages | 5 |
| Lines of implementation | ~3,600 |
| Tests | 88 (all passing) |
| Lint errors | 0 |
| Warnings | 26 (all `no-explicit-any` / `no-unused-vars`) |
| CI | Not configured |
| Published to npm | None |
