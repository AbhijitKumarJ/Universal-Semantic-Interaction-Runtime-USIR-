# USIR — Master Specification

**Universal Semantic Interaction Runtime**
*A semantic operating layer that decouples human intent from application implementation.*

---

## Executive Summary

Modern computing is built around **applications**. Humans interact with software through buttons, menus, windows, and screens — abstractions optimized for mice, keyboards, and displays.

LLMs expose a different possibility: humans communicate through **intent, context, memory, and relationships** — not interface widgets.

**USIR** proposes a universal semantic runtime that allows humans, agents, and applications to interact through shared semantic representations rather than application-specific user interfaces.

---

## Vision

### Current Computing
```
Human
  ↓
GUI
  ↓
Application
  ↓
Data
```
Every application reinvents navigation, search, commands, state management.

### USIR Computing
```
Human
  ↓
Intent
  ↓
USIR Runtime
  ↓
Capabilities
  ↓
Data
```
Applications become **capability providers**. The runtime becomes the **operating layer**.

---

## Core Thesis

> Software should expose **meaning** instead of **presentation**.
>
> The runtime should operate on **intent, context, memory, relationships, actions** — not on **buttons, menus, screens, coordinates**.

---

## Architectural Pillars

### Pillar 1: Universal Intent Ontology

The ontology is the semantic protocol of computing. ~50 cognitive verbs across 8 layers:

| Layer | Type | Example Intents |
|---|---|---|
| L0 | Meta | `cancel`, `repeat`, `undo`, `redo` |
| L0.5 | Provenance | (history queries, audit) |
| L1 | Navigation | `locate`, `open`, `close`, `navigate` |
| L2 | Attention | `focus`, `select`, `highlight` |
| L3 | Information | `explain`, `summarize`, `compare`, `search` |
| L4 | Manipulation | `edit`, `move`, `delete` |
| L5 | Creation | `create` |
| L6 | Execution | `run`, `schedule` |
| L7 | Delegation | `plan`, `delegate`, `checkpoint` |
| L8 | Collaboration | `share`, `discuss`, `annotate`, `broadcast` |

See: `packages/protocol/src/intents/index.ts`

### Pillar 2: Interaction Memory

The major failure of current voice systems: **no memory**. USIR introduces 4 kinds of context:

- **Temporal** — "the file I opened yesterday"
- **Conversational** — "compare it with the previous one"
- **Spatial** — "the item below that"
- **Semantic** — "the design discussion we had earlier"

See: `packages/protocol/src/memory/index.ts`, `packages/runtime/src/memory/interaction-memory.ts`

### Pillar 3: Semantic Graph

Everything becomes a node. Relationships become edges.

```
User
  ├── Project
  │    ├── File
  │    ├── Meeting
  │    └── Task
  │
  └── Agent
```

See: `packages/protocol/src/graph/index.ts`

### Pillar 4: Semantic Snapshot (Tiered)

Every adapter emits a `SemanticSnapshot` with three tiers:

- **Hot Tier** (16ms) — cursor, active entity, selection. The "invocation anchor."
- **Warm Tier** (150ms) — visible entities, panel layout, recent changes.
- **Cold Tier** (seconds, async) — full semantic graph with LSP metadata.

The runtime never blocks waiting for the Cold tier. It serves sub-second responses from Hot + Warm and fetches Cold on demand.

See: `packages/protocol/src/snapshot/index.ts`, `adapters/vscode/src/snapshot/engine.ts`

### Pillar 5: Deterministic Execution Layer

LLMs **never directly execute**. They plan:

```
Intent
  ↓
Planner (LLM)
  ↓
ExecutionPlan (JSON DAG)
  ↓
TopologicalExecutor
  ↓
Tools
```

This enables:
- **Safety** — plans are auditable before execution
- **Rollback** — provenance chain is replayable
- **Reproducibility** — same plan = same execution
- **Parallelism** — DAG dependencies enable concurrent steps
- **Trust** — agents act within delegated scope

See: `packages/runtime/src/router/llm-router.ts`, `packages/runtime/src/executor/topological-executor.ts`

### Pillar 6: Semantic Adapters

Adapters bridge existing software into USIR. Each adapter:
- Exposes entities (files, functions, panels) as `SemanticEntity` nodes
- Listens to app events (cursor, focus, change) → updates tiered snapshot
- Registers tools with the `ToolRegistry` for the executor
- Provides spatial/audio metadata for multi-modal clients

**Built today:**
- VS Code adapter (`adapters/vscode`)

**Planned:**
- Browser adapter (DOM → entities)
- OS adapter (processes → entities)
- Zero-Shot adapter (VLM-as-compiler for unknown apps)

---

## L0.5 Provenance (Review 1 addition)

The missing layer that tracks *why* mutations happened, not just *what* changed.

**Invariant:** the agent never mutates state without an entry in the provenance log. The provenance log is the source of truth for *what happened and why*.

Every provenance node records:
- The intent that caused the mutation
- The actor (user/agent/system) and their confidence
- The rationale (user-requested / delegated / inferred / system)
- The authorization (approved by human / delegated / pending / rejected)
- Causal parents (other nodes in the chain)
- Content hash before/after (for replay)
- Semantic diff (not text diff)

See: `packages/protocol/src/provenance/index.ts`, `packages/runtime/src/provenance/provenance-store.ts`

---

## A2U (Agent-to-USIR) Protocol (Semantic Horizon)

The protocol keeps the human meaningfully in control of agents they aren't watching.

**3 Trust Tiers:**
1. **Read-only** (explanation, search) — agent can do without asking
2. **Reversible mutations** (edit, create) — checkpoint on low confidence
3. **Irreversible** (delete, run, share) — always requires approval

**4 Urgency Levels:**
- `background` — queue for next idle moment
- `checkpoint` — surface a checkpoint waypoint with timeout
- `blocker` — interrupt the user immediately
- `completion` — task done

See: `packages/runtime/src/a2u/`

---

## Capability Marketplace (Review 2 addition)

The long-term endgame. Instead of an App Store, USIR envisions a **Capability Market** where intent handlers are dynamic services discovered, priced, and invoked at runtime.

```
Need translation?   → invoke translation capability
Need booking?        → invoke booking capability
Need CAD rendering?  → invoke rendering capability
```

See: `packages/protocol/src/capability/index.ts`

---

## MVP: Audio-Native IDE Copilot

The first deployment is a **VS Code extension** that lets developers navigate, edit, and orchestrate their workspace using natural language and voice.

**Why VS Code first?**
- Rich semantic APIs (LSP, Extension API)
- AI-fluent audience
- High-velocity target user (developers)
- Clear measurable use cases (refactor, navigate, test, commit)

**First 6 commands:**
1. `focus terminal, start dev server, tail logs`
2. `rename this to user_id everywhere, run tests`
3. `select main.py, run in python terminal`
4. `find the function causing the timeout`
5. `refactor the auth module`
6. `compare today's architecture with last week's version`

**Out of scope for MVP:** federated collaboration, agentic delegation, IoT, XR, ambient devices.

---

## Status

| Component | Status |
|---|---|
| `@usir/protocol` (schemas) | ✅ TypeScript types defined |
| `@usir/runtime` (brain) | ✅ Core classes implemented (memory, router, executor, provenance, A2U) |
| `@usir/audio-pipeline` (voice) | ✅ STT client, VAD, fused intent |
| `@usir/vscode-adapter` (tiered snapshot) | ✅ Hot/Warm/Cold tiers + tool registry |
| `@usir/vscode-extension` (MVP) | ✅ Activation, audio capture, routing, execution wired |
| Browser adapter | ⏳ Planned (Month 11-12) |
| OS adapter | ⏳ Planned (Year 2) |
| Federated runtime | ⏳ Planned (Year 2) |
| Capability marketplace | ⏳ Planned (Year 3+) |

---

## License

MIT
