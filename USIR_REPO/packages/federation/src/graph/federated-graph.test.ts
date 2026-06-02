import { describe, it, expect, beforeEach } from 'vitest';
import { createSemanticGraph, addEntity } from '@usir/protocol/graph';
import { createEntity } from '@usir/protocol/entities';
import { FederatedGraph } from './federated-graph';

describe('FederatedGraph', () => {
  let graph: FederatedGraph;

  beforeEach(() => {
    graph = new FederatedGraph('peer-a');
  });

  it('starts empty', () => {
    expect(graph.getNodeCount()).toBe(0);
    expect(graph.getVersion()).toBe(0);
  });

  it('imports a SemanticGraph', () => {
    const sg = createSemanticGraph();
    addEntity(sg, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    addEntity(sg, createEntity({ id: 'e2', role: 'class', displayName: 'Bar' }));

    graph.importGraph(sg);
    expect(graph.getNodeCount()).toBe(2);
    expect(graph.getVersion()).toBeGreaterThanOrEqual(1);
  });

  it('exports a graph identical to what was imported', () => {
    const sg = createSemanticGraph();
    addEntity(sg, createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    graph.importGraph(sg);

    const exported = graph.exportGraph();
    expect(exported.nodes.size).toBe(1);
    expect(exported.nodes.get('e1')!.entity.displayName).toBe('foo');
  });

  it('adds individual entities', () => {
    const entity = createEntity({ id: 'e1', role: 'function', displayName: 'foo' });
    graph.addEntity(entity);
    expect(graph.getNodeCount()).toBe(1);
    expect(graph.hasEntity('e1')).toBe(true);
  });

  it('removes entities', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    graph.removeEntity('e1');
    expect(graph.getNodeCount()).toBe(0);
    expect(graph.hasEntity('e1')).toBe(false);
  });

  it('updates entity fields', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    graph.updateEntity('e1', [{ field: 'displayName', value: 'bar' }]);

    const exported = graph.exportGraph();
    expect(exported.nodes.get('e1')!.entity.displayName).toBe('bar');
  });

  it('syncs between two graphs via Yjs update', () => {
    const graphA = new FederatedGraph('peer-a');
    const graphB = new FederatedGraph('peer-b');

    graphA.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    const update = graphA.getStateAsUpdate();

    graphB.applyUpdate(update);
    const exportedB = graphB.exportGraph();
    expect(exportedB.nodes.size).toBe(1);
    expect(exportedB.nodes.get('e1')!.entity.displayName).toBe('foo');
  });

  it('computes diffs from last known version', () => {
    graph.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    const diff1 = graph.computeDiffFromLastKnown();
    expect(diff1.patches.length).toBeGreaterThan(0);

    graph.addEntity(createEntity({ id: 'e2', role: 'class', displayName: 'Bar' }));
    const diff2 = graph.computeDiffFromLastKnown();
    expect(diff2.patches.length).toBeGreaterThan(0);
  });

  it('notifies observers on remote updates', () => {
    const events: string[] = [];
    graph.observe((event) => events.push(event.type));

    const remote = new FederatedGraph('peer-b');
    remote.addEntity(createEntity({ id: 'e1', role: 'function', displayName: 'foo' }));
    graph.applyUpdate(remote.getStateAsUpdate());

    expect(events).toContain('remote_update');
  });
});
