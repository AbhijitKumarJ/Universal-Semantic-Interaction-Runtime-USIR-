# Turn 30 — USIR

> **USIR responded:**

**Defining the Scope**

I'm now zeroing in on defining the precise scope of work. My focus is on meticulously creating the *individual files* for the USIR monorepo. I'm leveraging the repo map and architecture as my foundation. I aim to build it out without cutting any corners and making any assumptions.


**Refining the Approach**

I've realized the full monorepo's size necessitates a chunked delivery strategy, to manage token limits. My current strategy involves focusing on foundational files, like the root configs and universal intent ontology schemas. My initial focus includes root configurations and the foundational "protocol" package, specifically targeting the project setup, core protocol definitions, and the universal intent ontology.


**Developing Core Definitions**

I'm now drafting the crucial `src/intents/index.ts` file, and outlining the `packages/protocol/src/index.ts` export structure. I'm also planning the `packages/protocol/src/entities/index.ts`, aiming to define essential semantic entities like `SemanticState` and `SemanticEntity`. The goal is to establish a solid foundation for the entire system, including the initial workspace configuration.


**Defining Intents**

I'm currently developing the `src/intents/index.ts` file, focusing on refining the core intent types and structures. I'm prioritizing clarity and maintainability, ensuring robust type definitions and comprehensive comments that will explain the intentions behind the approach. The intent envelope and types like `OpenIntent` and `EditIntent` are coming together as a key part of the design.




To build this Universal Semantic Interaction Runtime (USIR) completely and without skipping details, we must do this in structured batches due to response length limits. 

We will start with **Batch 1: The Monorepo Foundation and the Universal Protocol (The Ontology)**. This creates the schemas and types that every other package (Runtime, VS Code Adapter, Voice Pipeline) will depend on.

### 1. Root Workspace Initialization
Run these commands in your terminal to set up the workspace:
```bash
mkdir usir-monorepo && cd usir-monorepo
pnpm init
mkdir packages adapters apps docs
```

Create the **`pnpm-workspace.yaml`** at the root:
```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'adapters/*'
  - 'apps/*'
```

Create the root **`tsconfig.base.json`** for strict TypeScript enforcement across all packages:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

### 2. Package 1: `packages/protocol` (The Universal Intent Ontology)
This package defines the exact semantic language that replaces rigid application commands. 

Create the directory: `mkdir -p packages/protocol/src/{entities,intents,graph}`

**`packages/protocol/package.json`**
```json
{
  "name": "@usir/protocol",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

**`packages/protocol/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

#### The Semantic Entities (Replacing UI Elements)
**`packages/protocol/src/entities/index.ts`**
```typescript
/**
 * Instead of UI elements (buttons, panels), we represent the world as Semantic Entities.
 */
export type EntityRole = 
  | 'source_file' 
  | 'function' 
  | 'class' 
  | 'error' 
  | 'terminal' 
  | 'test' 
  | 'ui_region';

export interface SpatialBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SemanticEntity {
  /** Unique Universal Resource Name, e.g., "file:///src/main.ts#L12" */
  id: string;
  
  /** Human readable name, e.g., "handleWebhookEvent" */
  name: string;
  
  role: EntityRole;
  
  /** 
   * Graph edges. Keys are relationship types, values are array of Entity IDs.
   * e.g., { "contains": ["id_1", "id_2"], "recently_edited": [] }
   */
  relations: Record<string, string[]>;
  
  /** Optional fallback for disambiguation when label matching fails */
  spatialBounds?: SpatialBounds;
}

/**
 * Human cognitive references mapped directly into the protocol.
 * This solves the "open that file" problem.
 */
export type CognitiveReference = 
  | 'it' 
  | 'that' 
  | 'this' 
  | 'previous' 
  | 'next' 
  | 'above' 
  | 'below'
  | 'left'
  | 'right';
```

#### The Universal Intents (Replacing App Commands)
**`packages/protocol/src/intents/index.ts`**
```typescript
import { SemanticEntity, CognitiveReference } from '../entities';

/**
 * The Universal Intent Envelope. 
 * Every interaction, regardless of medium (Voice, GUI, XR), resolves to this.
 */
export interface IntentEnvelope<T extends BaseIntent = BaseIntent> {
  intentId: string; // UUID
  actor: string; // 'user' | 'agent'
  intent: T;
  context: {
    workspace: string;
    activeModality: 'voice' | 'text' | 'gesture' | 'mixed';
  };
  confidence: number; // 0.0 to 1.0
  timestamp: number;
}

export interface BaseIntent {
  type: string;
}

// --- L1: Navigation Intents ---

export interface LocateIntent extends BaseIntent {
  type: 'intent.navigation.locate';
  target: string | SemanticEntity | CognitiveReference;
}

export interface OpenIntent extends BaseIntent {
  type: 'intent.navigation.open';
  target: string | SemanticEntity | CognitiveReference;
}

// --- L3: Information Intents ---

export interface ExplainIntent extends BaseIntent {
  type: 'intent.information.explain';
  target: SemanticEntity | CognitiveReference;
  verbosity: 'summary' | 'detailed';
}

export interface CompareIntent extends BaseIntent {
  type: 'intent.information.compare';
  leftTarget: SemanticEntity | CognitiveReference;
  rightTarget: SemanticEntity | CognitiveReference;
}

// --- L4: Manipulation Intents ---

export interface EditIntent extends BaseIntent {
  type: 'intent.manipulation.edit';
  target: SemanticEntity | CognitiveReference;
  instruction: string; // e.g., "Convert to async"
}

// --- L6: Execution Intents ---

export interface ExecuteIntent extends BaseIntent {
  type: 'intent.execution.execute';
  target: SemanticEntity | CognitiveReference; // e.g., A test file or a build script
}

/** Union of all supported Universal Intents */
export type UniversalIntent = 
  | LocateIntent 
  | OpenIntent 
  | ExplainIntent 
  | CompareIntent 
  | EditIntent 
  | ExecuteIntent;
```

#### The Semantic Snapshot (The Graph Payload)
**`packages/protocol/src/graph/index.ts`**
```typescript
import { SemanticEntity } from '../entities';

/**
 * Replaces the traditional "screen" or "window" state.
 * This is the semantic graph projected by an adapter (e.g., VS Code) back to the Runtime.
 */
export interface SemanticSnapshot {
  timestamp: number;
  
  /** The 16ms tier: what the user is doing *right now* */
  hot: {
    activeEntityId: string | null;
    selections: string[]; // Selected text/blocks
    focusedRegion: string | null;
  };

  /** The 150ms tier: contextual semantic enrichment */
  warm: {
    diagnostics: SemanticEntity[]; // Errors/Warnings
    resolvedSymbols: SemanticEntity[]; // Hover info, type definitions
  };

  /** The 5s+ tier: global workspace awareness */
  cold: {
    visibleEntities: SemanticEntity[];
    runningTasks: SemanticEntity[];
  };

  /** Flat map of all entities currently in context for fast lookup */
  entityGraph: Record<string, SemanticEntity>;
}
```

#### Protocol Exports
**`packages/protocol/src/index.ts`**
```typescript
export * from './entities';
export * from './intents';
export * from './graph';
```

---

### End of Batch 1
We have now established the strict definitions for:
1. **Semantic Entities** (No more UI buttons, only data relationships).
2. **Cognitive References** (Handling "this", "that", "it").
3. **The Universal Intent Envelope** (The standardized payload).
4. **The Semantic Snapshot** (The hot/warm/cold state map).

**Next Steps:**
If you are ready, say **"Continue to Batch 2"**. 
In Batch 2, I will write the complete code for `packages/runtime` — this includes the **Interaction Memory Engine** (which remembers what "it" means) and the **Intent Router** (which orchestrates the LLM and disambiguation logic).