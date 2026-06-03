/**
 * Topological Executor — runs an ExecutionPlan in dependency order.
 *
 * LLM plans; runtime executes. The executor maintains the invariant that
 * every step is either completed or failed before the plan terminates,
 * and that parallel steps are run concurrently.
 *
 * Supports retry with exponential backoff and per-tool circuit breakers
 * to handle transient failures gracefully.
 */

import type { ExecutionPlan, ExecutionStep, ExecutionResult, StepResult } from '../router/types';
import type { ToolRegistry } from '../disambiguation/collaborative-narrowing';
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5_000,
  backoffFactor: 2,
};

function isRetryable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Logical errors — retrying won't help
  if (msg.includes('not found in registry')) return false;
  if (msg.includes('UNRESOLVED:')) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffFactor, attempt);
  // Add jitter ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, config.maxDelayMs);
}

export class TopologicalExecutor {
  private toolCircuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryConfig: RetryConfig;

  constructor(
    private toolRegistry: ToolRegistry,
    private onStepStart?: (step: ExecutionStep) => void,
    private onStepComplete?: (result: StepResult) => void,
    retryConfig?: Partial<RetryConfig>,
    private circuitBreakerOptions?: Partial<CircuitBreakerOptions>,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY, ...retryConfig };
  }

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
    // Circuit breaker check — fail fast if the breaker for this tool is OPEN
    const breaker = this.getOrCreateBreaker(step.tool);
    if (!breaker.allowRequest()) {
      return {
        stepId: step.stepId,
        success: false,
        error: `Circuit breaker OPEN for tool '${step.tool}' — failing fast`,
        durationMs: 0,
        affectedEntityIds: [],
        provenanceId: `provenance-cb-${step.stepId}`,
        retryCount: 0,
        circuitBreakerTripped: true,
      };
    }

    const stepStart = Date.now();
    this.onStepStart?.(step);

    let lastError: unknown;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = computeBackoff(attempt - 1, this.retryConfig);
        await sleep(delay);
      }

      try {
        const tool = this.toolRegistry.getTool(step.tool);
        if (!tool) {
          throw new Error(`Tool not found in registry: ${step.tool}`);
        }
        const resolvedArgs = this.resolveArgs(step.args, previousResults);
        const output = await tool.execute(resolvedArgs);

        // Success — tell the breaker and return
        breaker.recordSuccess();
        return {
          stepId: step.stepId,
          success: true,
          output,
          durationMs: Date.now() - stepStart,
          affectedEntityIds: this.extractAffectedEntities(output),
          provenanceId: this.extractProvenanceId(output) ?? `provenance-pending-${step.stepId}`,
          retryCount: attempt,
        };
      } catch (err) {
        lastError = err;
        retryCount = attempt + 1;

        if (!isRetryable(err) || attempt >= this.retryConfig.maxRetries) {
          // Non-retryable or exhausted — break out
          break;
        }
      }
    }

    // All attempts failed — report and notify the breaker
    breaker.recordFailure();
    return {
      stepId: step.stepId,
      success: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      durationMs: Date.now() - stepStart,
      affectedEntityIds: [],
      provenanceId: `provenance-failed-${step.stepId}`,
      retryCount,
    };
  }

  private getOrCreateBreaker(toolName: string): CircuitBreaker {
    let breaker = this.toolCircuitBreakers.get(toolName);
    if (!breaker) {
      breaker = new CircuitBreaker(this.circuitBreakerOptions);
      this.toolCircuitBreakers.set(toolName, breaker);
    }
    return breaker;
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

  /** Reset all circuit breaker state (useful for testing or manual recovery) */
  public resetCircuitBreakers(): void {
    this.toolCircuitBreakers.clear();
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
