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
| **4. Semantic Snapshot** | `adapters/*` | 3-tier (Hot/Warm/Cold) snapshot every adapter emits |
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
│   ├── vscode/            # VS Code adapter (Hot/Warm/Cold tiered snapshots, 9 tools, 65 tests)
│   ├── browser/           # Browser in-process adapter (DOM → SemanticEntity, 7 tools, 67 tests)
│   └── playwright/        # Playwright zero-shot adapter (headless browser automation, 8 tools)
├── apps/
│   └── vscode-extension/  # The deployable VS Code extension (MVP entry point)
├── docs/
│   ├── MASTER-SPEC.md     # Canonical architecture spec
│   ├── ROADMAP.md         # 12-month execution plan
│   ├── 01-the-gui-trap.md # "Beyond the GUI" 6-part blog series (all written)
│   ├── ...
│   └── semantic-horizon/  # "Semantic Horizon" 5-part blog series
├── TechStack.md           # Technology stack reference
├── IMPLEMENTATION.md      # Implementation status & next steps
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
```

### Available commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile all packages |
| `pnpm typecheck` | Type-check all packages (no emit) |
| `pnpm lint` | Lint all packages (ESLint + typescript-eslint) |
| `pnpm test` | Run all tests (Vitest, 501 tests) |
| `pnpm clean` | Remove all build artifacts |
| `pnpm dev` | Watch mode for all packages |

## Documentation

- [Master Specification](docs/MASTER-SPEC.md) — the canonical architecture
- [12-Month Roadmap](docs/ROADMAP.md) — execution plan
- [Implementation Status](IMPLEMENTATION.md) — what's done and what's next
- [Tech Stack](TechStack.md) — languages, tools, versions
- [Blog Series: Beyond the GUI (6 parts)](docs/01-the-gui-trap.md) — philosophical foundation
  - [Part 1: The GUI Trap](docs/01-the-gui-trap.md)
  - [Part 2: The Universal Protocol](docs/02-the-universal-protocol.md)
  - [Part 3: The Adapter Layer](docs/03-the-adapter-layer.md)
  - [Part 4: The Runtime](docs/04-the-runtime.md)
  - [Part 5: Collaborative Narrowing](docs/05-collaborative-narrowing.md)
  - [Part 6: Ambient Computing](docs/06-ambient-computing.md)
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

[![build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![tests](https://img.shields.io/badge/tests-501-brightgreen)]()
[![lint](https://img.shields.io/badge/lint-passing-brightgreen)]()
[![typescript](https://img.shields.io/badge/TypeScript-5.9-blue)]()
[![license](https://img.shields.io/badge/license-MIT-green)]()

🚧 **Pre-alpha** — All core types, runtime classes, adapters, audio pipeline, federation, and VS Code extension are implemented. Build is clean, **501 tests pass** across 12 packages, lint is configured. Key recent additions: Webview audio capture, local Whisper fallback (binary→cloud), dual JSON/SQLite persistence (shared `Storage` interface), retry+circuit breaker in executor, TreeWalker DOM extraction (SPA-safe). Next up: CI/CD pipeline, publish `@usir/protocol` to npm, and test the extension in a live VS Code instance.

## License

MIT
