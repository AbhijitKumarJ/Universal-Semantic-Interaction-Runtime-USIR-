import { describe, it, expect } from 'vitest';
import { TopologicalExecutor } from './topological-executor';
import { ToolRegistry } from '../disambiguation/collaborative-narrowing';
import type { ExecutionPlan } from '../router/types';

describe('TopologicalExecutor', () => {
  it('executes a single step successfully', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.tool',
      description: 'test',
      execute: async () => ({ success: true, affectedEntityIds: ['e1'] }),
    });
    const exec = new TopologicalExecutor(registry);
    const plan: ExecutionPlan = {
      planId: 'plan-1',
      rawInstruction: 'do it',
      steps: [{ stepId: 's1', tool: 'test.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
      ambiguities: [],
      confidence: 1,
      detectedIntentType: 'intent.execution.run',
      createdAt: Date.now(),
      trustTier: 1,
    };
    const result = await exec.execute(plan);
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
    const plan: ExecutionPlan = {
      planId: 'plan-2',
      rawInstruction: 'fail',
      steps: [{ stepId: 's1', tool: 'fail.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
      ambiguities: [],
      confidence: 1,
      detectedIntentType: 'intent.execution.run',
      createdAt: Date.now(),
      trustTier: 1,
    };
    const result = await exec.execute(plan);
    expect(result.success).toBe(false);
    expect(result.failedStepIds).toEqual(['s1']);
  });

  it('reports error for unregistered tool', async () => {
    const registry = new ToolRegistry();
    const exec = new TopologicalExecutor(registry);
    const plan: ExecutionPlan = {
      planId: 'plan-3',
      rawInstruction: 'unknown',
      steps: [{ stepId: 's1', tool: 'ghost.tool', args: {}, dependsOn: [], optional: false, confidence: 1 }],
      ambiguities: [],
      confidence: 1,
      detectedIntentType: 'intent.execution.run',
      createdAt: Date.now(),
      trustTier: 1,
    };
    const result = await exec.execute(plan);
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
    const plan: ExecutionPlan = {
      planId: 'plan-4',
      rawInstruction: 'resolve me',
      steps: [{ stepId: 's1', tool: 'test.tool', args: { target: 'UNRESOLVED:which-file' }, dependsOn: [], optional: false, confidence: 1 }],
      ambiguities: [{ field: 'steps[0].args.target', candidates: ['f1', 'f2'], question: 'Which file?' }],
      confidence: 1,
      detectedIntentType: 'intent.execution.run',
      createdAt: Date.now(),
      trustTier: 1,
    };
    const result = await exec.execute(plan);
    expect(result.success).toBe(false);
    expect(result.stepResults[0].error).toContain('UNRESOLVED');
  });
});
