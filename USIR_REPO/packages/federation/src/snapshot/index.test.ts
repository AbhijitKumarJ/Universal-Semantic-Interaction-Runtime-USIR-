import { describe, it, expect } from 'vitest';
import { createSemanticGraph, addEntity } from '@usir/protocol/graph';
import { createEntity } from '@usir/protocol/entities';
import { computeDiff, applyDiff } from './index';

describe('FederatedSnapshot', () => {
  it('computes diff between two graphs', () => {
    const from = createSemanticGraph();
    const to = createSemanticGraph();

    addEntity(to, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));

    const diff = computeDiff(from, to, 'peer-a');
    expect(diff.patches.length).toBeGreaterThanOrEqual(1);
    expect(diff.patches.some((p) => p.op === 'addEntity')).toBe(true);
    expect(diff.sourcePeerId).toBe('peer-a');
  });

  it('computes remove patch', () => {
    const from = createSemanticGraph();
    addEntity(from, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    const to = createSemanticGraph();

    const diff = computeDiff(from, to, 'peer-a');
    expect(diff.patches.some((p) => p.op === 'removeEntity')).toBe(true);
  });

  it('computes update patch', () => {
    const from = createSemanticGraph();
    const entity = createEntity({ id: 'e1', role: 'function', displayName: 'foo' });
    addEntity(from, entity);

    const to = createSemanticGraph();
    const updated = createEntity({ id: 'e1', role: 'function', displayName: 'bar' });
    addEntity(to, updated);

    const diff = computeDiff(from, to, 'peer-a');
    expect(diff.patches.some((p) => p.op === 'updateEntity')).toBe(true);
  });

  it('applies patches to a graph', () => {
    const graph = createSemanticGraph();
    const from = createSemanticGraph();
    const to = createSemanticGraph();
    addEntity(to, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));

    const diff = computeDiff(from, to, 'peer-a');
    const result = applyDiff(graph, diff);

    expect(result.nodes.has('e1')).toBe(true);
    expect(result.nodes.get('e1')!.entity.displayName).toBe('foo');
  });

  it('round-trips: computeDiff then applyDiff produces identical graph', () => {
    const original = createSemanticGraph();
    addEntity(original, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    addEntity(original, createEntity({ id: 'e2', role: 'class', displayName: 'Bar' }));

    const empty = createSemanticGraph();
    const diff = computeDiff(empty, original, 'peer-a');
    const restored = applyDiff(createSemanticGraph(), diff);

    expect(restored.nodes.size).toBe(2);
    expect(restored.nodes.get('e1')!.entity.displayName).toBe('foo');
  });
});
