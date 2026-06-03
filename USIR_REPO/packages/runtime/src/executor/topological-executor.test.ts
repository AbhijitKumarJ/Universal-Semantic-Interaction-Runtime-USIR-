import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopologicalExecutor } from './topological-executor';
import { ToolRegistry } from '../disambiguation/collaborative-narrowing';
import type { ExecutionPlan } from '../router/types';

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    planId: 'plan-test',
    rawInstruction: 'test',
    steps: [{ stepId: 's1', tool: 'test.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
    ambiguities: [],
    confidence: 1,
    detectedIntentType: 'intent.execution.run',
    createdAt: Date.now(),
    trustTier: 1,
    ...overrides,
  };
}

describe('TopologicalExecutor', () => {
  it('executes a single step successfully', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.tool',
      description: 'test',
      execute: async () => ({ success: true, affectedEntityIds: ['e1'] }),
    });
    const exec = new TopologicalExecutor(registry);
    const result = await exec.execute(makePlan());
    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.failedStepIds).toEqual([]);
  });

  it('reports failure on tool error', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'fail.tool',
      description: 'failing tool',
      execute: async () => { throw new Error('oops'); },
    });
    const exec = new TopologicalExecutor(registry);
    const result = await exec.execute(makePlan({
      steps: [{ stepId: 's1', tool: 'fail.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
    }));
    expect(result.success).toBe(false);
    expect(result.failedStepIds).toEqual(['s1']);
  });

  it('reports error for unregistered tool', async () => {
    const registry = new ToolRegistry();
    const exec = new TopologicalExecutor(registry);
    const result = await exec.execute(makePlan({
      steps: [{ stepId: 's1', tool: 'ghost.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
    }));
    expect(result.success).toBe(false);
    expect(result.stepResults[0].error).toContain('not found');
  });

  it('throws on UNRESOLVED args at execution time', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.tool',
      description: 'test',
      execute: async () => ({}),
    });
    const exec = new TopologicalExecutor(registry);
    const result = await exec.execute(makePlan({
      steps: [{ stepId: 's1', tool: 'test.tool', args: { target: 'UNRESOLVED:which-file' }, dependsOn: [], optional: false, confidence: 1 }],
      ambiguities: [{ field: 'steps[0].args.target', candidates: ['f1', 'f2'], question: 'Which file?' }],
    }));
    expect(result.success).toBe(false);
    expect(result.stepResults[0].error).toContain('UNRESOLVED');
  });
});

describe('retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('succeeds on first attempt without retry', async () => {
    const registry = new ToolRegistry();
    const fn = vi.fn().mockResolvedValue({ ok: true });
    registry.register({ name: 'tool', description: 't', execute: fn });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 });

    const promise = exec.execute(makePlan({ steps: [{ stepId: 's1', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.stepResults[0].retryCount).toBe(0);
  });

  it('retries on transient failure and succeeds', async () => {
    const registry = new ToolRegistry();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ ok: true });
    registry.register({ name: 'tool', description: 't', execute: fn });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 });

    const promise = exec.execute(makePlan({ steps: [{ stepId: 's1', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.stepResults[0].retryCount).toBe(2);
  });

  it('fails after exhausting all retries', async () => {
    const registry = new ToolRegistry();
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    registry.register({ name: 'tool', description: 't', execute: fn });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 });

    const promise = exec.execute(makePlan({ steps: [{ stepId: 's1', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result.stepResults[0].error).toBe('persistent');
  });

  it('does NOT retry non-retryable errors (tool not found)', async () => {
    const registry = new ToolRegistry();
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 });

    const result = await exec.execute(makePlan({ steps: [{ stepId: 's1', tool: 'does.not.exist', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));

    expect(result.success).toBe(false);
    expect(result.stepResults[0].error).toContain('not found');
  });

  it('does NOT retry UNRESOLVED argument errors', async () => {
    const registry = new ToolRegistry();
    registry.register({ name: 'tool', description: 't', execute: async () => ({}) });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 });

    const result = await exec.execute(makePlan({ steps: [{ stepId: 's1', tool: 'tool', args: { x: 'UNRESOLVED:what' }, dependsOn: [], optional: false, confidence: 1 }] }));

    expect(result.success).toBe(false);
    expect(result.stepResults[0].error).toContain('UNRESOLVED');
    expect(result.stepResults[0].retryCount).toBe(1); // only the initial attempt, no retries
  });
});

describe('circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('trips after threshold failures and fails fast on next execute', async () => {
    const registry = new ToolRegistry();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    registry.register({ name: 'tool', description: 't', execute: fn });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 }, { threshold: 2, cooldownMs: 60_000, halfOpenMaxRequests: 1 });

    // First two steps (in separate plans) push the breaker to OPEN
    const plan1 = makePlan({ planId: 'p1', steps: [{ stepId: 's1', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] });
    const r1 = await exec.execute(plan1);
    expect(r1.success).toBe(false);

    const plan2 = makePlan({ planId: 'p2', steps: [{ stepId: 's2', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] });
    const r2 = await exec.execute(plan2);
    expect(r2.success).toBe(false);

    expect(fn).toHaveBeenCalledTimes(2);

    // Third step should fail fast — circuit breaker is OPEN
    const plan3 = makePlan({ planId: 'p3', steps: [{ stepId: 's3', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] });
    const r3 = await exec.execute(plan3);
    expect(r3.success).toBe(false);
    expect(r3.stepResults[0].circuitBreakerTripped).toBe(true);
    expect(r3.stepResults[0].error).toContain('Circuit breaker OPEN');
    // No new executions — s3 was fast-failed
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('recovers after cooldown when tool starts succeeding', async () => {
    const registry = new ToolRegistry();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true });
    registry.register({ name: 'tool', description: 't', execute: fn });
    const exec = new TopologicalExecutor(registry, undefined, undefined, { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffFactor: 2 }, { threshold: 2, cooldownMs: 1_000, halfOpenMaxRequests: 1 });

    // Two failures — breaker OPENS
    await exec.execute(makePlan({ planId: 'p1', steps: [{ stepId: 's1', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    await exec.execute(makePlan({ planId: 'p2', steps: [{ stepId: 's2', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    expect(fn).toHaveBeenCalledTimes(2);

    // Wait for cooldown to pass
    vi.advanceTimersByTime(1_100);

    // Next execution should probe (half-open) — now succeeds, breaker CLOSES
    const result = await exec.execute(makePlan({ planId: 'p3', steps: [{ stepId: 's3', tool: 'tool', args: {}, dependsOn: [], optional: false, confidence: 1 }] }));
    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
