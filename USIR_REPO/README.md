# USIR — Universal Semantic Interaction Runtime

> A semantic operating layer that decouples human intent from application implementation.

## The Problem

Modern computing is built around **applications**. Humans interact with software through buttons, menus, windows, and screens — abstractions optimized for mice, keyboards, and displays.

LLMs expose a different possibility: humans communicate through **intent, context, memory, and relationships** — not interface widgets.

**USIR** proposes a universal semantic runtime that allows humans, agents, and applications to interact through shared semantic representations rather than application-specific user interfaces.

## The Thesis

```
Software should expose:  Meaning         instead of:  Presentation
The runtime operates on: Intent, Memory,               Buttons, Pixels,
                          Relationships,                Coordinates,
                          Actions                      Menus
```

## Architecture (6 Pillars)

| Pillar | Package | Purpose |
|---|---|---|
| **1. Universal Intent Ontology** | `@usir/protocol` | The "HTTP of interaction" — ~50 cognitive verbs across 8 layers (L1–L8) |
| **2. Interaction Memory** | `@usir/runtime` | Resolves "it", "that", "previous" via temporal/spatial/conversational/semantic context |
| **3. Semantic Graph** | `@usir/protocol` | Apps expose entities, not widgets |
| **4. Semantic Snapshot** | `@usir/protocol` | Universal representation every adapter emits |
| **5. Deterministic Execution** | `@usir/runtime` | LLM plans, runtime executes (auditable, rollback-able, parallel) |
| **6. Semantic Adapters** | `adapters/*` | Bridges existing software (VS Code, browser, OS) into USIR |

Plus **L0.5 Provenance** — the missing layer that tracks *why* mutations happened, not just *what* changed.

## Repository Structure

```
usir/
├── packages/
│   ├── protocol/          # Universal Intent Ontology, SemanticEntity, SemanticSnapshot
│   ├── runtime/           # Interaction Memory, Intent Router, Topological Executor
│   └── audio-pipeline/    # Whisper STT, VAD, FusedIntent
├── adapters/
│   └── vscode/            # VS Code adapter (Hot/Warm/Cold tiered snapshots)
├── apps/
│   └── vscode-extension/  # The deployable VS Code extension (MVP entry point)
├── docs/
│   ├── MASTER-SPEC.md     # Canonical architecture spec
│   ├── ROADMAP.md         # 12-month execution plan
│   ├── *.md               # "Beyond the GUI" 6-part blog series
│   └── semantic-horizon/  # "Semantic Horizon" 5-part blog series
└── examples/
    └── bmad-wizard/       # BMAD brainstorming wizard PoC
```

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

# Run the VS Code extension in dev mode
pnpm --filter @usir/vscode-extension run dev

# Run tests
pnpm test
```

## Documentation

- [Master Specification](docs/MASTER-SPEC.md) — the canonical architecture
- [12-Month Roadmap](docs/ROADMAP.md) — execution plan
- [Blog Series: Beyond the GUI](docs/01-the-gui-trap.md) — philosophical foundation
- [Blog Series: The Semantic Horizon](docs/semantic-horizon/01-zero-shot-adapter.md) — future expansion

## Inspiration

USIR draws from the historical analogy of protocol layers:

| Protocol | What It Abstracted |
|---|---|
| TCP/IP | Networking |
| HTML | Documents |
| HTTP | Request/response |
| **USIR** | **Interaction** |

## Status

🚧 **Pre-alpha** — Core schemas and MVP being built. The semantic runtime, ontology, and VS Code adapter are the focus of the first 6 months.

## License

MIT
