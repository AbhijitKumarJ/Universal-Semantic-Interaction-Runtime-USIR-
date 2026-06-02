# Universal-Semantic-Interaction-Runtime (USIR)
USIR - Universal Semantic Interaction Runtime - Towards a Post-GUI Computing Architecture

## USIR Ideation - Ideation FOLDER

Folders are numbered in order of attempts at reining the ideas behind USIR through multiple conversations.

## USIR Implementation — USIR_REPO FOLDER

> A semantic operating layer that decouples human intent from application implementation.
> [![build](https://img.shields.io/badge/build-passing-brightgreen)]() [![tests](https://img.shields.io/badge/tests-325-brightgreen)]() [![license](https://img.shields.io/badge/license-MIT-green)]()

**Status:** Pre-alpha. All core types, runtime, VS Code extension, federated runtime, and capability marketplace phases 1–5 are implemented. 325 tests pass, 0 lint errors, build is clean across 12 packages. See [`USIR_REPO/IMPLEMENTATION.md`](USIR_REPO/IMPLEMENTATION.md) for detailed status.

## Motivation

Modern computing is built around **applications**. Humans interact with software through buttons, menus, windows, and screens — abstractions optimized for mice, keyboards, and displays.

LLMs expose a different possibility: humans communicate through **intent, context, memory, and relationships** — not interface widgets.

**USIR** proposes a universal semantic runtime that allows humans, agents, and applications to interact through shared semantic representations rather than application-specific user interfaces.

## Architecture (6 Pillars + Provenance)

| Pillar | Package | Purpose |
|---|---|---|
| **1. Universal Intent Ontology** | `@usir/protocol` | ~50 cognitive verbs across 8 layers (L0–L8) |
| **2. Interaction Memory** | `@usir/runtime` | Resolves "it", "that", "previous" via 4 reference kinds |
| **3. Semantic Graph** | `@usir/protocol` | Apps expose entities, not widgets |
| **4. Semantic Snapshot** | `@usir/protocol` | 3-tier (Hot/Warm/Cold) snapshot every adapter emits |
| **5. Deterministic Execution** | `@usir/runtime` | LLM plans, runtime executes (DAG, auditable, parallel) |
| **6. Semantic Adapters** | `adapters/*` | Bridges for VS Code, browser, Playwright, OS, IoT, XR |

Plus **L0.5 Provenance** — tracks *why* mutations happened, not just *what* changed, with causal chains across runtimes.

## Repository Structure

```
usir/
├── packages/
│   ├── protocol/              # Universal Intent Ontology, SemanticEntity, SemanticSnapshot
│   ├── runtime/               # Interaction Memory, Intent Router, Topological Executor, A2U
│   ├── audio-pipeline/        # Whisper STT, VAD, FusedIntent
│   ├── federation/            # P2P runtime federation (WebRTC, CRDT sync, L8 handlers)
│   ├── registry/              # Capability marketplace REST API (publish, search, trust, pricing)
│   ├── registry-client/       # Registry client SDK (cache, sync, discovery)
│   ├── adapters-os/           # OS adapters (process, filesystem, window, shell, system)
│   ├── adapters-iot/          # IoT adapters (MQTT, CoAP, Modbus/OPC-UA, sensor fusion)
│   └── adapters-xr/           # XR adapters (Unity bridge, spatial anchors, XR input)
├── adapters/
│   ├── vscode/                # VS Code tiered snapshot engine + 9 tools
│   ├── browser/               # Browser DOM accessibility tree adapter
│   └── playwright/            # Playwright zero-shot adapter (8 tools)
├── apps/
│   └── vscode-extension/      # Deployable VS Code extension (MVP entry point)
├── docs/
│   ├── MASTER-SPEC.md         # Canonical architecture spec
│   ├── FEDERATION.md          # Federation architecture & deployment guide
│   ├── IMPLEMENTATION.md      # Detailed implementation status
│   ├── ROADMAP.md             # 12-month execution plan
│   ├── *.md                   # "Beyond the GUI" 6-part blog series
│   └── semantic-horizon/      # "Semantic Horizon" 5-part blog series
└── ontology/
    └── universal-intent-ontology-v1.md  # 1.0 candidate spec
```

## Packages

| Package | LOC | Tests | Description |
|---------|-----|-------|-------------|
| `@usir/protocol` | ~2,000 | 41 | Shared schemas, ontologies, entity types |
| `@usir/runtime` | ~1,880 | 42 | Core engine: memory, router, executor, A2U, provenance |
| `@usir/audio-pipeline` | ~480 | 10 | Voice capture, VAD, STT, fused intent |
| `@usir/federation` | ~4,760 | 62 | P2P WebRTC, CRDT graph sync, L8 collaboration |
| `@usir/registry` | ~2,440 | 72 | Capability marketplace REST API |
| `@usir/registry-client` | ~440 | 8 | Registry client SDK |
| `@usir/adapters-os` | ~990 | 30 | Process, filesystem, window, shell, system adapters |
| `@usir/adapters-iot` | ~1,080 | 33 | MQTT, CoAP, Modbus/OPC-UA, sensor fusion |
| `@usir/adapters-xr` | ~710 | 20 | Unity bridge, spatial anchors, XR input |
| `@usir/vscode-adapter` | ~560 | 0 | VS Code tiered snapshots + 9 tools |
| `@usir/browser-adapter` | ~490 | 0 | Browser DOM accessibility tree |
| `@usir/playwright-adapter` | ~470 | 7 | Playwright DOM extractor + 8 tools |

## Key Concepts

- **L0.5 Provenance**: Every mutation records intent, actor, rationale, authorization chain, causal parents, and semantic diffs. Auditable, replayable, cross-runtime.
- **A2U Protocol**: 3-tier trust gate (auto/confirm/block) keeps humans in control of autonomous agents.
- **3-Tier Snapshot**: Hot (16ms — cursor/focus), Warm (150ms — visible entities), Cold (seconds — full graph).
- **Federated Runtime**: P2P WebRTC with Yjs CRDT sync, L8 collaboration handlers (share, discuss, annotate, broadcast).
- **Capability Marketplace**: Public registry, trust scoring (weighted factors + exponential decay), pricing & invoicing (free/call/metered/subscription), payout system.

## MVP

A **VS Code extension** that lets developers navigate, edit, and orchestrate their workspace using natural language and voice. The IDE is the perfect "trojan horse" — it has rich semantics (LSP, ASTs, file graphs) and the audience is already AI-fluent.

Targeted first commands:
- *"Focus terminal, start the dev server, tail the logs"*
- *"Rename this to `user_id` everywhere and run the test suite"*
- *"Select main.py, run it in python terminal"*

## Quick Start

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm -r test

# Lint all packages
pnpm -r lint

# Run the VS Code extension in dev mode
pnpm --filter @usir/vscode-extension run dev
```

## Documentation

- [Master Specification](docs/MASTER-SPEC.md) — canonical architecture
- [Federation Architecture](docs/FEDERATION.md) — P2P protocol, CRDT sync, deployment
- [Implementation Status](USIR_REPO/IMPLEMENTATION.md) — phase-by-phase status
- [12-Month Roadmap](docs/ROADMAP.md) — execution plan
- [Blog Series: Beyond the GUI (6 parts)](docs/01-the-gui-trap.md)
  - [Part 1: The GUI Trap](docs/01-the-gui-trap.md)
  - [Part 2: The Universal Protocol](docs/02-the-universal-protocol.md)
  - [Part 3: The Adapter Layer](docs/03-the-adapter-layer.md)
  - [Part 4: The Runtime](docs/04-the-runtime.md)
  - [Part 5: Collaborative Narrowing](docs/05-collaborative-narrowing.md)
  - [Part 6: Ambient Computing](docs/06-ambient-computing.md)
- [Blog Series: The Semantic Horizon](docs/semantic-horizon/01-zero-shot-adapter.md)
- [Intent Ontology v1.0 Candidate](/ontology/universal-intent-ontology-v1.md)

## Inspiration

USIR draws from the historical analogy of protocol layers:

| Protocol | What It Abstracted |
|---|---|
| TCP/IP | Networking |
| HTML | Documents |
| HTTP | Request/response |
| **USIR** | **Interaction** |

## Status

🚧 **Pre-alpha** — Core runtime, federation, and capability marketplace are implemented. 325 tests pass across 12 packages with 0 lint errors. Next: CI/CD, npm publication, browser adapter, and public alpha.

## License

MIT
