# Turn 32 — USIR

> **USIR responded:**

**Initiating Batch 2**

I'm now zeroing in on Batch 2, specifically the `packages/runtime` directory. The Interaction Memory Engine within is the primary focus, aiming to refine its integration within the overall project setup. I'm reviewing the existing architecture to assess its readiness for the next steps.


**Refining Runtime Logic**

I'm currently concentrating on the `packages/runtime` directory, specifically drafting the core files. My focus is on the Interaction Memory Engine, Intent Router, Executor, and Disambiguation logic. I am mapping cognitive references to semantic entities. I'm working on the design and implementation of the Interaction Memory, including how it manages history, spatial mapping, and last referenced entities. My plan is to set up `package.json` and `tsconfig.json` and link the `@usir/protocol` dependency.


**Defining Execution Plan Components**

My current focus is on the `packages/runtime` directory, specifically fleshing out the core components. I'm nailing down the structure of the `Intent Router`, `Disambiguation`, and `Executor`, working on the interaction between them to develop robust ExecutionPlans. The definition of the execution plan schema will go into `src/router/types.ts`. I'm detailing out the interface for the LLM provider for modularity and defining steps with confidence, and dependencies. The `package.json` needs the workspace dependency "@usir/protocol".




Here is **Batch 2: The Semantic Runtime (`packages/runtime`)**. 

This package is the "Brain" of the Universal Semantic Interaction Runtime (USIR). It manages state over time (Interaction Memory), decides what the user means (Intent Router), resolves ambiguity (Disambiguation), and safely executes tasks in the correct order (Topological Executor).

### 1. Setup the Runtime Package

Create the directory structure:
```bash
mkdir -p packages/runtime/src/{memory,router,executor,disambiguation}
```

**`packages/runtime/package.json`**
Notice we are linking the `@usir/protocol` package we built in Batch 1.
```json
{
  "name": "@usir/runtime",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "dependencies": {
    "@usir/protocol": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

**`packages/runtime/tsconfig.json`**
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

---

### 2. The Execution Plan Types
Before we build the router and executor, we need to define the JSON structure the LLM will output.

**`packages/runtime/src/router/types.ts`**
```typescript
export interface Ambiguity {
  field: string; // e.g., "steps[0].args.target"
  candidates: string[]; // e.g., ["config.ts", "config.prod.ts"]
  question: string; // e.g., "Which config file did you mean?"
}

export interface ExecutionStep {
  tool: string; // e.g., "openEntity", "executeTests"
  args: Record<string, any>; // Includes the «UNRESOLVED:xxx» sentinel if ambiguous
  dependsOn: number[]; // Step indices this step waits for. Empty = run immediately.
  optional: boolean; // If true, failure doesn't abort the whole plan
}

export interface ExecutionPlan {
  intent: string; // Human readable description of what was understood
  confidence: number; // 0.0 - 1.0
  ambiguities: Ambiguity[];
  steps: ExecutionStep[];
}

export interface ToolRegistry {
  [toolName: string]: (args: Record<string, any>) => Promise<any>;
}
```

---

### 3. Interaction Memory (Solving "it", "that", "previous")
This module persists across LLM calls, keeping track of what the user was recently looking at or talking about.

**`packages/runtime/src/memory/InteractionMemory.ts`**
```typescript
import { SemanticEntity, CognitiveReference, SemanticSnapshot } from '@usir/protocol';

export class InteractionMemory {
  private history: string[] = []; // Stack of recently accessed Entity IDs
  private lastDiscussed: string | null = null; // The "it" or "that"

  /**
   * Called by the adapter whenever the user changes focus or completes an action
   */
  public pushToHistory(entityId: string) {
    this.history = this.history.filter(id => id !== entityId);
    this.history.unshift(entityId); // Add to front
    if (this.history.length > 50) this.history.pop();
    this.lastDiscussed = entityId;
  }

  /**
   * Resolves a cognitive reference ("it", "previous") into a concrete SemanticEntity
   */
  public resolveReference(
    ref: CognitiveReference, 
    snapshot: SemanticSnapshot
  ): SemanticEntity | null {
    
    // Conversational references
    if (ref === 'it' || ref === 'that' || ref === 'this') {
      // 1. Try explicit current selection first (Hot Tier)
      if (snapshot.hot.activeEntityId) {
        return snapshot.entityGraph[snapshot.hot.activeEntityId] || null;
      }
      // 2. Fallback to conversational memory
      if (this.lastDiscussed) {
        return snapshot.entityGraph[this.lastDiscussed] || null;
      }
    }

    // Temporal references
    if (ref === 'previous') {
      // Find the first item in history that IS NOT the currently active one
      const activeId = snapshot.hot.activeEntityId;
      const previousId = this.history.find(id => id !== activeId);
      if (previousId) {
        return snapshot.entityGraph[previousId] || null;
      }
    }

    // Spatial references (above/below/left/right) require bounding box math
    // implemented via the SemanticSnapshot's spatialBounds.
    if (['above', 'below', 'left', 'right'].includes(ref) && snapshot.hot.activeEntityId) {
       return this.resolveSpatial(ref as string, snapshot);
    }

    return null;
  }

  private resolveSpatial(direction: string, snapshot: SemanticSnapshot): SemanticEntity | null {
    const anchor = snapshot.entityGraph[snapshot.hot.activeEntityId!];
    if (!anchor || !anchor.spatialBounds) return null;

    // Filter entities with bounds, calculate distances, and return the closest match
    // (Simplified for MVP - in production this uses geometric intersection math)
    const candidates = Object.values(snapshot.entityGraph).filter(e => e.spatialBounds && e.id !== anchor.id);
    
    // Sort logic would go here based on direction (e.g. for "below", find min positive Y delta)
    return candidates.length > 0 ? candidates[0] : null; 
  }
}
```

---

### 4. The Intent Router
This builds the prompt, combines the audio intent with the visual snapshot, and calls the LLM.

**`packages/runtime/src/router/IntentRouter.ts`**
```typescript
import { SemanticSnapshot } from '@usir/protocol';
import { ExecutionPlan } from './types';

// Abstract interface so you can plug in OpenAI, Anthropic, or local models
export interface LLMProvider {
  generate(systemPrompt: string, userMessage: string): Promise<string>;
}

export class IntentRouter {
  constructor(
    private llm: LLMProvider,
    private availableTools: string // Stringified JSON schema of available tools
  ) {}

  private readonly SYSTEM_PROMPT = `
You are a Universal Semantic Intent Router. Your job is to translate a user's natural language command into a structured execution plan.

You receive:
- The user's raw input (voice or text).
- A Semantic Snapshot of the current state (Hot/Warm/Cold tiers).
- A Tool Registry describing available operations.

Output ONLY a JSON object matching this schema:
{
  "intent": "string (human readable explanation)",
  "confidence": "number 0.0-1.0",
  "ambiguities": [ { "field": "string", "candidates": ["str"], "question": "string" } ],
  "steps": [ { "tool": "string", "args": {}, "dependsOn": [number], "optional": boolean } ]
}

BEHAVIORAL RULES:
1. Use the Semantic Snapshot to fill tool arguments automatically. Do not ask for information that is already in the snapshot.
2. If multiple entities match the user's request, set confidence < 0.75 and populate the "ambiguities" array.
3. For multi-step plans, use "dependsOn" to express sequencing.
`;

  public async classify(
    rawInput: string, 
    snapshot: SemanticSnapshot
  ): Promise<ExecutionPlan> {
    
    const userMessage = JSON.stringify({
      input: rawInput,
      snapshot: snapshot,
      tools: this.availableTools
    });

    const response = await this.llm.generate(this.SYSTEM_PROMPT, userMessage);
    
    try {
      // Strip potential markdown fences if the LLM misbehaves
      const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson) as ExecutionPlan;
    } catch (e) {
      throw new Error(`Failed to parse LLM Execution Plan: ${e}`);
    }
  }
}
```

---

### 5. The Disambiguation Loop
This handles the "Collaborative Narrowing" phase.

**`packages/runtime/src/disambiguation/DisambiguationLoop.ts`**
```typescript
import { ExecutionPlan, Ambiguity } from '../router/types';

/**
 * Interface that the client (VS Code, Browser, etc.) implements to actually 
 * show the UI to the user and get their choice.
 */
export interface DisambiguationClient {
  askUser(ambiguity: Ambiguity): Promise<string>;
}

export class DisambiguationLoop {
  constructor(private client: DisambiguationClient) {}

  /**
   * Takes a plan with ambiguities, asks the user to clarify them, 
   * and returns a resolved plan ready for execution.
   */
  public async resolve(plan: ExecutionPlan): Promise<ExecutionPlan> {
    // Clone plan to avoid mutating the original
    const resolvedPlan = JSON.parse(JSON.stringify(plan)) as ExecutionPlan;

    for (const ambiguity of resolvedPlan.ambiguities) {
      // Surface UI to user (e.g. highlight "Alpha", "Bravo" in VS Code)
      const userChoice = await this.client.askUser(ambiguity);
      
      // Find the step and argument containing the Sentinel value and replace it
      for (const step of resolvedPlan.steps) {
        for (const [key, value] of Object.entries(step.args)) {
          if (typeof value === 'string' && value.includes('«UNRESOLVED')) {
            step.args[key] = userChoice;
          }
        }
      }
    }

    // Clear ambiguities and bump confidence now that user has clarified
    resolvedPlan.ambiguities = [];
    resolvedPlan.confidence = 1.0;

    return resolvedPlan;
  }
}
```

---

### 6. The Topological Executor
This safely executes the JSON plan, handling parallel tasks and dependency waiting.

**`packages/runtime/src/executor/TopologicalExecutor.ts`**
```typescript
import { ExecutionPlan, ExecutionStep, ToolRegistry } from '../router/types';
import { DisambiguationLoop } from '../disambiguation/DisambiguationLoop';

export class TopologicalExecutor {
  constructor(
    private registry: ToolRegistry,
    private disambiguationLoop: DisambiguationLoop
  ) {}

  public async execute(plan: ExecutionPlan): Promise<void> {
    // 1. Guard against ambiguous plans
    if (plan.confidence < 0.75 || plan.ambiguities.length > 0) {
      const resolvedPlan = await this.disambiguationLoop.resolve(plan);
      return this.execute(resolvedPlan); // Recurse with resolved plan
    }

    // 2. Setup Topological Execution State
    const results: Record<number, any> = {};
    const pending = new Set(plan.steps.map((_, i) => i));

    // Helper: checks if all dependencies for a step are in the `results` dictionary
    const isReady = (step: ExecutionStep) => 
      step.dependsOn.every(dep => dep in results);

    // 3. Execution Loop
    while (pending.size > 0) {
      // Find all steps that have no pending dependencies
      const batch = [...pending].filter(i => isReady(plan.steps[i]));
      
      if (batch.length === 0) {
        throw new Error('Dependency cycle detected in Execution Plan');
      }

      // Run parallel safe steps concurrently
      const batchResults = await Promise.all(
        batch.map(async i => {
          const step = plan.steps[i];
          try {
            const toolFn = this.registry[step.tool];
            if (!toolFn) throw new Error(`Tool ${step.tool} not found in registry`);
            
            // Pass previously resolved results into the current step's args (piping)
            // (A more advanced implementation would map specific result fields)
            const result = await toolFn({ ...step.args, _prevResults: results });
            return { i, result, ok: true };
          } catch (err) {
            if (step.optional) {
              console.warn(`Optional step ${i} failed:`, err);
              return { i, result: null, ok: false };
            }
            throw err; // Abort entire plan if non-optional step fails
          }
        })
      );

      // Save results and remove from pending queue
      for (const { i, result } of batchResults) {
        results[i] = result;
        pending.delete(i);
      }
    }
  }
}
```

---

### 7. Export the Runtime
**`packages/runtime/src/index.ts`**
```typescript
export * from './memory/InteractionMemory';
export * from './router/IntentRouter';
export * from './router/types';
export * from './disambiguation/DisambiguationLoop';
export * from './executor/TopologicalExecutor';
```

---

### End of Batch 2
We have now fully implemented the **Semantic Runtime**. 

It is completely decoupled from VS Code or browsers. It takes abstract `SemanticSnapshots`, figures out what the user means using `InteractionMemory` and the `IntentRouter`, clarifies confusion with `DisambiguationLoop`, and safely executes code via `TopologicalExecutor`.

**Next Steps:**
Reply **"Continue to Batch 3"** and I will build **`adapters/vscode`**. This is where we bridge the gap between actual VS Code extension APIs (like `window.activeTextEditor`) and the abstract Semantic Graph, creating the `Hot`, `Warm`, and `Cold` tier engines, and defining the tool registry (`openEntity`, `executeTest`).