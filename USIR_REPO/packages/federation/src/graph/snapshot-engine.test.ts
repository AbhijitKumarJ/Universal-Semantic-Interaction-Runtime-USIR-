import { describe, it, expect, beforeEach } from 'vitest';
import { createEntity } from '@usir/protocol/entities';
import { FederatedGraph } from './federated-graph';
import { FederatedSnapshotEngine } from './snapshot-engine';

describe('FederatedSnapshotEngine', () => {
  let graph: FederatedGraph;
  let engine: FederatedSnapshotEngine;

  beforeEach(() => {
    graph = new FederatedGraph('peer-a');
    engine = new FederatedSnapshotEngine(graph, { localPeerId: 'peer-a', maxWarmEntities: 10, maxColdEntities: 50 });
  });

  it('builds a hot snapshot', () => {
    const entity = createEntity({ id: 'e1', role: 'function', displayName: 'foo' });
    const hot = engine.buildHotSnapshot(entity, 'editor');
    expect(hot.tier).toBe('hot');
    expect(hot.activeEntity.id).toBe('e1');
    expect(hot.activeRegion).toBe('editor');
  });

  it('builds a warm snapshot from graph entities', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    graph.addEntity(createEntity({ id: 'e2', role: 'class', displayName: 'Bar' }));

    const warm = engine.buildWarmSnapshot();
    expect(warm.tier).toBe('warm');
    expect(warm.visible.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a cold snapshot with the full graph', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    const cold = engine.buildColdSnapshot();
    expect(cold.tier).toBe('cold');
    expect(cold.graph.nodes.size).toBe(1);
  });

  it('builds a complete SemanticSnapshot', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    const entity = createEntity({ id: 'e1', role: 'function', displayName: 'foo' });
    const full = engine.buildFullSnapshot(entity, 'editor');
    expect(full.source).toContain('peer-a');
    expect(full.version).toBe(1);
    expect(full.hot.tier).toBe('hot');
    expect(full.warm.tier).toBe('warm');
    expect(full.cold!.tier).toBe('cold');
  });
});
