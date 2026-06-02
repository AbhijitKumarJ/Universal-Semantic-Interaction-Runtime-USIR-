import { describe, it, expect } from 'vitest';
import { createSemanticGraph, addEntity, removeEntity, bfs, findEntities } from './index';
import { createEntity } from '../entities';

describe('SemanticGraph', () => {
  it('creates an empty graph', () => {
    const graph = createSemanticGraph();
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.version).toBe(0);
  });

  it('adds a single entity', () => {
    const graph = createSemanticGraph();
    const entity = createEntity({ id: 'f1', role: 'function', displayName: 'foo' });
    addEntity(graph, entity);
    expect(graph.nodes.size).toBe(1);
    expect(graph.version).toBe(1);
    expect(graph.byRole.get('function')?.has('f1')).toBe(true);
    expect(graph.bySource.get('unknown')?.has('f1')).toBe(true);
  });

  it('adds entities with edges', () => {
    const graph = createSemanticGraph();
    const fn = createEntity({ id: 'fn1', role: 'function', displayName: 'bar' });
    addEntity(graph, fn);
    const file = createEntity({
      id: 'f1',
      role: 'source_file',
      displayName: 'a.ts',
      relations: [{ kind: 'contains', targetId: 'fn1' }],
    });
    addEntity(graph, file);
    expect(graph.nodes.get('f1')?.outbound).toContain('fn1');
    expect(graph.nodes.get('fn1')?.inbound).toContain('f1');
    expect(graph.edges).toHaveLength(1);
  });

  it('removes an entity', () => {
    const graph = createSemanticGraph();
    const entity = createEntity({ id: 'f1', role: 'function', displayName: 'foo' });
    addEntity(graph, entity);
    removeEntity(graph, 'f1');
    expect(graph.nodes.size).toBe(0);
    expect(graph.byRole.get('function')?.has('f1')).toBe(false);
  });

  it('updates indices on remove', () => {
    const graph = createSemanticGraph();
    const a = createEntity({ id: 'a', role: 'source_file', displayName: 'a.ts' });
    const b = createEntity({
      id: 'b',
      role: 'source_file',
      displayName: 'b.ts',
      relations: [{ kind: 'references', targetId: 'a' }],
    });
    addEntity(graph, a);
    addEntity(graph, b);
    removeEntity(graph, 'a');
    expect(graph.nodes.get('b')?.outbound).not.toContain('a');
  });
});

describe('bfs', () => {
  it('visits nodes in breadth-first order up to max depth', () => {
    const graph = createSemanticGraph();
    const grandchild = createEntity({ id: 'grandchild', role: 'unknown', displayName: 'gc' });
    addEntity(graph, grandchild);
    const child1 = createEntity({
      id: 'child1',
      role: 'unknown',
      displayName: 'c1',
      relations: [{ kind: 'contains', targetId: 'grandchild' }],
    });
    addEntity(graph, child1);
    const child2 = createEntity({ id: 'child2', role: 'unknown', displayName: 'c2' });
    addEntity(graph, child2);
    const root = createEntity({
      id: 'root',
      role: 'unknown',
      displayName: 'root',
      relations: [
        { kind: 'contains', targetId: 'child1' },
        { kind: 'contains', targetId: 'child2' },
      ],
    });
    addEntity(graph, root);

    const visited: string[] = [];
    bfs(graph, 'root', 1, (id) => { visited.push(id); });
    expect(visited[0]).toBe('root');
    expect(visited.slice(1).sort()).toEqual(['child1', 'child2'].sort());
  });

  it('respects visitor returning false to stop', () => {
    const graph = createSemanticGraph();
    const b = createEntity({ id: 'b', role: 'unknown', displayName: 'b' });
    addEntity(graph, b);
    const c = createEntity({ id: 'c', role: 'unknown', displayName: 'c' });
    addEntity(graph, c);
    const a = createEntity({
      id: 'a',
      role: 'unknown',
      displayName: 'a',
      relations: [
        { kind: 'references', targetId: 'b' },
        { kind: 'references', targetId: 'c' },
      ],
    });
    addEntity(graph, a);

    const visited: string[] = [];
    bfs(graph, 'a', 5, (id) => { visited.push(id); return id !== 'b'; });
    expect(visited).toContain('a');
    expect(visited).toContain('b');
  });
});

describe('findEntities', () => {
  it('finds entities matching predicate', () => {
    const graph = createSemanticGraph();
    addEntity(graph, createEntity({ id: 'f1', role: 'function', displayName: 'foo' }));
    addEntity(graph, createEntity({ id: 'f2', role: 'function', displayName: 'bar' }));
    addEntity(graph, createEntity({ id: 'f3', role: 'class', displayName: 'Baz' }));
    const result = findEntities(graph, (e) => e.role === 'function');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id).sort()).toEqual(['f1', 'f2']);
  });
});
