# USIR — Technology Stack

## Runtime

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | >=18.0.0 | JavaScript runtime |
| pnpm | >=8.0.0 (8.12.0) | Package manager with workspace support |

## Language

| Technology | Version | Details |
|------------|---------|---------|
| TypeScript | ^5.3.3 (5.9.3) | Typed superset of JavaScript |
| ES Target | ES2022 | Modern JavaScript output |
| Module System | ESNext (packages), Node16 (vscode-extension) | ES modules across monorepo |
| Module Resolution | Bundler (packages), Node16 (vscode-extension) | Node.js compatible resolution |
| Strictness | strict, esModuleInterop, isolatedModules | Full type safety enabled |

## Build Pipeline

| Technology | Version | Role |
|------------|---------|------|
| Turborepo | ^1.11.0 (1.13.4) | Monorepo orchestrator — parallel builds, caching, pipeline management |
| tsc | Built into TypeScript | TypeScript compilation for all packages |
| vsce | — | VS Code extension packaging (`pnpm package`) |

Pipeline stages: `build` -> `test`/`typecheck` -> `lint`

## Testing

| Technology | Version | Role |
|------------|---------|------|
| Vitest | ^4.1.8 (4.1.8) | Test runner — all 3 tested packages |
| Vite | 8.0.16 (transitive) | Underlying dev server/bundler for Vitest |

88 tests across 3 packages, all passing.

## Linting

| Technology | Version | Role |
|------------|---------|------|
| ESLint | ^10.4.1 (10.4.1) | Linting engine (flat config) |
| @eslint/js | ^10.0.1 (10.0.1) | Recommended JavaScript rules |
| typescript-eslint | ^8.60.1 (8.60.1) | TypeScript-aware linting rules |

Key rules: `consistent-type-imports` (error), `no-unused-vars` (warn), `no-explicit-any` (warn).

## Monorepo Structure

| Package | Path | Dependencies |
|---------|------|-------------|
| @usir/protocol | packages/protocol/ | None (zero runtime deps) |
| @usir/runtime | packages/runtime/ | @usir/protocol |
| @usir/audio-pipeline | packages/audio-pipeline/ | @usir/protocol |
| @usir/vscode-adapter | adapters/vscode/ | @usir/protocol, @usir/runtime |
| @usir/vscode-extension | apps/vscode-extension/ | All above packages |

## Platform APIs Used

| API | Context |
|-----|---------|
| Web Crypto API (`crypto.subtle`) | SHA-256 hashing for provenance |
| `node:crypto` | SHA-256 fallback (dynamic import) |
| `fetch()` | LLM (OpenAI) and STT (Groq) API calls |
| Web Audio API | Microphone capture, audio processing |
| VS Code Extension API | Editor integration, snapshots, commands |
| `FormData` / `Blob` | Audio file upload to Whisper STT |

## External Services

| Service | Endpoint | Usage |
|---------|----------|-------|
| OpenAI | api.openai.com | LLM intent routing (GPT-4o) |
| Groq | api.groq.com | Whisper STT (whisper-large-v3-turbo) |

## Development Workflow

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm typecheck      # Type-check all packages
pnpm lint           # Lint all packages
pnpm test           # Run all tests
pnpm clean          # Clean all build artifacts
pnpm package:vscode # Package VS Code extension (.vsix)
```
