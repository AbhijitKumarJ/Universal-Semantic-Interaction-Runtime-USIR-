import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColdTier } from './cold';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'source_file', displayName: id });
}

describe('ColdTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty graph', () => {
    const tier = new ColdTier(onUpdate);
    const graph = tier.exportGraph();
    expect(graph.nodes.size).toBe(0);
  });

  it('addEntity adds to graph and schedules update', () => {
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    expect(tier.exportGraph().nodes.has('f1')).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('addEntity accepts optional LSP metadata', () => {
    const tier = new ColdTier(onUpdate);
    const meta = { entityId: 'f1', diagnostics: [] };
    tier.addEntity(entity('f1'), meta);
    expect(tier.getLspMetadata('f1')).toEqual(meta);
  });

  it('removeEntity deletes entity from graph', async () => {
    vi.useRealTimers();
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    await new Promise((r) => setTimeout(r, 1100));
    tier.removeEntity('f1');
    await new Promise((r) => setTimeout(r, 100));
    expect(tier.exportGraph().nodes.has('f1')).toBe(false);
    vi.useFakeTimers();
  });

  it('removeEntity deletes LSP metadata', async () => {
    vi.useRealTimers();
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'), { entityId: 'f1', diagnostics: [] });
    await new Promise((r) => setTimeout(r, 1100));
    tier.removeEntity('f1');
    await new Promise((r) => setTimeout(r, 100));
    expect(tier.getLspMetadata('f1')).toBeUndefined();
    vi.useFakeTimers();
  });

  it('projectSubgraph returns entities via BFS', () => {
    const tier = new ColdTier(onUpdate);
    const f1 = entity('f1');
    const f2 = entity('f2');
    const f3 = entity('f3');
    f1.relations = [{ kind: 'imports', targetId: 'f2' }];
    f2.relations = [{ kind: 'imports', targetId: 'f3' }];
    tier.addEntity(f1);
    tier.addEntity(f2);
    tier.addEntity(f3);
    const result = tier.projectSubgraph('f1', 2);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toContain('f1');
    expect(result.map((e) => e.id)).toContain('f2');
  });

  it('projectSubgraph respects maxDepth', () => {
    const tier = new ColdTier(onUpdate);
    const f1 = entity('f1');
    const f2 = entity('f2');
    const f3 = entity('f3');
    f1.relations = [{ kind: 'imports', targetId: 'f2' }];
    f2.relations = [{ kind: 'imports', targetId: 'f3' }];
    tier.addEntity(f1);
    tier.addEntity(f2);
    tier.addEntity(f3);
    const result = tier.projectSubgraph('f1', 1);
    expect(result).toHaveLength(2);
  });

  it('toSnapshot returns correct ColdSnapshot shape', () => {
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    vi.advanceTimersByTime(1000);
    const snap = tier.toSnapshot();
    expect(snap.tier).toBe('cold');
    expect(snap.graph.nodes.size).toBe(1);
    expect(typeof snap.capturedAt).toBe('number');
    expect(snap.latencyBudgetMs).toBe(5000);
  });

  it('debounce schedules update with 1000ms delay', () => {
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple addEntity within debounce window', () => {
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    tier.addEntity(entity('f2'));
    tier.addEntity(entity('f3'));
    vi.advanceTimersByTime(1000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('exportGraph returns the internal graph', () => {
    const tier = new ColdTier(onUpdate);
    tier.addEntity(entity('f1'));
    const graph = tier.exportGraph();
    expect(graph.nodes.get('f1')).toBeDefined();
  });

  it('default maxDepth is 3', () => {
    const tier = new ColdTier(onUpdate);
    expect((tier as any).maxDepth).toBe(3);
  });
});
