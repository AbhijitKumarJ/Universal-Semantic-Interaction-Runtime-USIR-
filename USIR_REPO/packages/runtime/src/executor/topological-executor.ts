/**
 * Topological Executor — runs an ExecutionPlan in dependency order.
 *
 * LLM plans; runtime executes. The executor maintains the invariant that
 * every step is either completed or failed before the plan terminates,
 * and that parallel steps are run concurrently.
 */

import type { ExecutionPlan, ExecutionStep, ExecutionResult, StepResult } from '../router/types';
import type { ToolRegistry } from '../disambiguation/collaborative-narrowing';

export class TopologicalExecutor {
  constructor(
    private toolRegistry: ToolRegistry,
    private onStepStart?: (step: ExecutionStep) => void,
    private onStepComplete?: (result: StepResult) => void,
  ) {}

  public async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const start = Date.now();
    const stepResults = new Map<string, StepResult>();
    const completed = new Set<string>();
    const failed = new Set<string>();
    const inFlight = new Map<string, Promise<StepResult>>();

    // Process steps in topological order
    while (completed.size + failed.size < plan.steps.length) {
      // Find ready steps (deps satisfied, not yet running or done)
      const ready = plan.steps.filter((step) => {
        if (completed.has(step.stepId) || failed.has(step.stepId) || inFlight.has(step.stepId)) {
          return false;
        }
        return step.dependsOn.every((depId) => completed.has(depId) || (step.optional && failed.has(depId)));
      });

      if (ready.length === 0 && inFlight.size === 0) {
        // Deadlock — should never happen for a valid plan
        break;
      }

      // Launch all ready steps in parallel
      for (const step of ready) {
        const promise = this.runStep(step, stepResults);
        inFlight.set(step.stepId, promise);
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        const finished = await Promise.race(inFlight.values());
        inFlight.delete(finished.stepId);
        stepResults.set(finished.stepId, finished);
        this.onStepComplete?.(finished);
        if (finished.success) {
          completed.add(finished.stepId);
        } else {
          failed.add(finished.stepId);
        }
      }
    }

    return {
      planId: plan.planId,
      success: failed.size === 0,
      stepResults: Array.from(stepResults.values()),
      totalDurationMs: Date.now() - start,
      failedStepIds: Array.from(failed),
    };
  }

  private async runStep(step: ExecutionStep, previousResults: Map<string, StepResult>): Promise<StepResult> {
    const stepStart = Date.now();
    this.onStepStart?.(step);
    try {
      const tool = this.toolRegistry.getTool(step.tool);
      if (!tool) {
        throw new Error(`Tool not found in registry: ${step.tool}`);
      }
      // Resolve any UNRESOLVED:xxx sentinels in args
      const resolvedArgs = this.resolveArgs(step.args, previousResults);
      const output = await tool.execute(resolvedArgs);
      return {
        stepId: step.stepId,
        success: true,
        output,
        durationMs: Date.now() - stepStart,
        affectedEntityIds: this.extractAffectedEntities(output),
        provenanceId: this.extractProvenanceId(output) ?? `provenance-pending-${step.stepId}`,
      };
    } catch (err) {
      return {
        stepId: step.stepId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - stepStart,
        affectedEntityIds: [],
        provenanceId: `provenance-failed-${step.stepId}`,
      };
    }
  }

  private resolveArgs(args: Record<string, unknown>, previousResults: Map<string, StepResult>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('UNRESOLVED:')) {
        // The disambiguation UI should have filled this in before execution.
        // If it reaches here, it's a runtime error.
        throw new Error(`Unresolved argument at execution time: ${value}`);
      }
      resolved[key] = value;
    }
    return resolved;
  }

  private extractAffectedEntities(output: unknown): string[] {
    if (output && typeof output === 'object' && 'affectedEntityIds' in output) {
      return (output as any).affectedEntityIds;
    }
    return [];
  }

  private extractProvenanceId(output: unknown): string | null {
    if (output && typeof output === 'object' && 'provenanceId' in output) {
      return (output as any).provenanceId;
    }
    return null;
  }
}
