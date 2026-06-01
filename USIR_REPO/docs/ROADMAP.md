# USIR — 12-Month Execution Roadmap

> **Caveat from the second review:** This timeline is **optimistic**. The semantic ontology in particular may need a year of public iteration to stabilize, not 2 months. Treat the first 6 months as "build the MVP that proves the architecture", and the second 6 as "open it up for early adopters and let the ontology harden."

---

## Phase 1: Foundation (Months 1–2)

**Goal:** Lock the schemas and runtime skeleton.

### Tasks
- [x] Define `@usir/protocol` package: `SemanticEntity`, `BaseIntent`, `SemanticSnapshot`, `InteractionWaypoint`
- [x] Define all 8 intent layers (L0–L8) plus L0.5 Provenance
- [x] Define `CognitiveReference` (4 kinds: temporal/conversational/spatial/semantic)
- [x] Set up monorepo: Turborepo + pnpm workspaces
- [x] Set up `tsconfig.base.json` with strict mode
- [x] Lint, typecheck, build pipeline

### Deliverables
- A published `@usir/protocol` package
- All TypeScript types compile cleanly
- The 6-pillar master spec is in `docs/MASTER-SPEC.md`

---

## Phase 2: VS Code Adapter (Months 3–4)

**Goal:** A working tiered snapshot engine.

### Tasks
- [x] Build `SnapshotEngine` with Hot/Warm/Cold tiers
- [x] Hook VS Code events: `onDidChangeActiveTextEditor`, `onDidChangeTextEditorSelection`
- [x] Build `ToolRegistry` and 9 VS Code tools (open, focus, edit, command, test, terminal, search, locate, refactor)
- [x] Build the `BoundedFileSystem` walker (never load the full graph synchronously)
- [x] Map VS Code's Accessibility Tree to `SemanticEntity` for surfaces that don't have native APIs
- [x] Add provenance hooks in the tool implementations

### Deliverables
- The adapter is ready to plug into a runtime
- The Hot Tier is observable as a real <16ms response
- Tools can be invoked by an `ExecutionPlan`

---

## Phase 3: Interaction Memory + Router (Months 5–6)

**Goal:** Voice input resolves to execution plans.

### Tasks
- [x] Build `InteractionMemory` (history, last discussed, conversation log)
- [x] Build `CognitiveReference` resolvers (temporal, conversational, spatial, semantic)
- [x] Build `LLMRouter` with strict JSON-output prompting
- [x] Build the system + user prompt templates (`INTENT_ROUTER_SYSTEM_PROMPT`, `buildRouterUserPrompt`)
- [x] Wire Whisper STT (Groq fastest, OpenAI fallback)
- [x] Build `FusedIntent` (linguistic + pointing + implicit)
- [x] Build the disambiguation Waypoint renderer for ambiguous commands

### Deliverables
- The user can speak a command, and USIR converts it to an `ExecutionPlan`
- Ambiguous commands surface a Waypoint instead of failing
- Memory works across a session

---

## Phase 4: Topological Executor + Agent Foundation (Months 7–8)

**Goal:** Plans run safely and deterministically.

### Tasks
- [x] Build `TopologicalExecutor` (DAG execution, parallel steps, dependency tracking)
- [x] Build `ProvenanceStore` (records every mutation with `ProvenanceNode`)
- [x] Build `TrustClassifier` (3-tier gate for agent actions)
- [x] Build `A2UDispatcher` (routes A2U envelopes to immediate/queued/checkpoint/blocker)
- [x] Build the 4 agent surfacing reasons (checkpoint, uncertainty, constraint-violation, completion)
- [x] Add `DelegateIntent` schema and constraints handling

### Deliverables
- Multi-step plans execute in parallel
- Every mutation has a provenance record
- Agents can delegate with confidence thresholds
- A checkpoint UI shows diffs and asks for approval

---

## Phase 5: VS Code Extension MVP (Months 9–10)

**Goal:** A real, shippable extension.

### Tasks
- [x] Wire `extension.ts` to all subsystems
- [x] Push-to-talk keybinding (`Ctrl+Shift+Space` / `Cmd+Shift+Space`)
- [x] Status bar item + indicator
- [x] Snapshot view webview
- [x] Provenance view webview
- [x] Settings: API keys (OpenAI, Groq), LLM endpoint
- [x] Disambiguation Waypoint UI (HTML panel)
- [x] Auto-update `InteractionMemory` from cursor focus

### Deliverables
- The extension can be packaged as a `.vsix` and installed
- The 6 first commands work end-to-end
- Settings docs and a demo video

---

## Phase 6: Browser Adapter + Public Alpha (Months 11–12)

**Goal:** Cross-app workflows.

### Tasks
- [ ] Build `@usir/browser-adapter` using the DOM Accessibility Tree
- [ ] Build a Playwright-based zero-shot adapter prototype
- [ ] Add a "Capability Registry" — discover tools across adapters
- [ ] Public alpha on GitHub: invite 100 developers
- [ ] Open `docs/ontology/` for community proposals
- [ ] Write a 1.0 candidate spec for the Universal Intent Ontology

### Deliverables
- A 12-month retrospective blog
- v0.5.0 release
- Community RFC process documented

---

## Year 2: Federated Runtime

- Federated `SemanticGraph` over WebRTC (P2P)
- L8 Collaboration Intents (share, discuss, annotate)
- Provenance chains across multiple runtimes
- A first `USIR Cloud` (hosted runtime) for users who don't want to self-host

## Year 3+: Capability Marketplace

- Public capability registry
- Trust score system for capability providers
- Pricing/invoicing (post-MVP)
- OS-level adapter (processes, files, windows as entities)
- IoT / XR adapters (from the Semantic Horizon series)

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Ontology too small / too large | Open community RFC process in Month 11 |
| A11y API flakiness (especially on non-Electron apps) | Have a VLM-compiler Zero-Shot adapter as backup |
| LLM latency > sub-1s | Cache the 16ms Hot Tier aggressively; do cold calls in background |
| Federation adds 100x complexity | Defer to Year 2; don't over-engineer Year 1 |
| User trust issues (agent delegation) | A2U protocol with mandatory provenance from day 1 |

---

## North Star

By end of Year 1, the success metric is:
- **A developer can `Cmd+Shift+Space` and say "find the function causing this timeout" — and get the right answer in < 3 seconds, with provenance showing exactly which search was run and why.**

If that single interaction works well, USIR is real. Everything else is scale.
