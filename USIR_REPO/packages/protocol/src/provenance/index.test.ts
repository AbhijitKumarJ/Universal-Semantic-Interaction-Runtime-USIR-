import { describe, it, expect } from 'vitest';
import { createProvenanceGraph, recordProvenance, walkCausalChain, hashEntity } from './index';
import { createEntity } from '../entities';
import type { ProvenanceNode } from './index';

function makeNode(overrides: Partial<ProvenanceNode> = {}): ProvenanceNode {
  return {
    provenanceId: 'p1',
    intentId: 'int-1',
    intentSnapshot: {
      type: 'intent.manipulation.edit',
      intentId: 'int-1',
      timestamp: Date.now(),
      actor: { type: 'user', id: 'user-1' },
      confidence: 1,
    },
    actor: { type: 'user', id: 'user-1' },
    rationale: { type: 'user-requested', rawInput: 'rename foo', interpretedIntent: 'edit' },
    authorization: { type: 'delegated', delegateIntentId: 'int-1' },
    causalParents: [],
    timestamp: Date.now(),
    contentHashBefore: 'abc',
    contentHashAfter: 'def',
    semanticDiff: {
      entityId: 'e1',
      entityBefore: {},
      entityAfter: {},
      changedFields: [{ field: 'displayName', before: 'foo', after: 'bar', kind: 'attribute' }],
    },
    ...overrides,
  };
}

describe('ProvenanceGraph', () => {
  it('creates an empty graph', () => {
    const graph = createProvenanceGraph();
    expect(graph.nodes.size).toBe(0);
  });

  it('records a single provenance node', () => {
    const graph = createProvenanceGraph();
    const node = makeNode();
    recordProvenance(graph, node);
    expect(graph.nodes.size).toBe(1);
    expect(graph.byEntity.get('e1')).toContain('p1');
    expect(graph.byIntent.get('int-1')).toBe('p1');
    expect(graph.byActor.get('user:user-1')).toContain('p1');
  });

  it('indexes relation target entities', () => {
    const graph = createProvenanceGraph();
    const node = makeNode({
      semanticDiff: {
        entityId: 'e1',
        entityBefore: {},
        entityAfter: {},
        changedFields: [
          { field: 'relations', before: [], after: 'e2', kind: 'relation_added' },
        ],
      },
    });
    recordProvenance(graph, node);
    expect(graph.byEntity.get('e1')).toContain('p1');
    expect(graph.byEntity.get('e2')).toContain('p1');
  });
});

describe('walkCausalChain', () => {
  it('returns a single node when no parents', () => {
    const graph = createProvenanceGraph();
    recordProvenance(graph, makeNode());
    const chain = walkCausalChain(graph, 'p1');
    expect(chain).toHaveLength(1);
    expect(chain[0].provenanceId).toBe('p1');
  });

  it('walks up causal parents', () => {
    const graph = createProvenanceGraph();
    recordProvenance(graph, makeNode({ provenanceId: 'p1', causalParents: [] }));
    recordProvenance(graph, makeNode({ provenanceId: 'p2', causalParents: ['p1'] }));
    const chain = walkCausalChain(graph, 'p2');
    expect(chain).toHaveLength(2);
    expect(chain[0].provenanceId).toBe('p1');
    expect(chain[1].provenanceId).toBe('p2');
  });
});

describe('hashEntity', () => {
  it('produces a stable 64-char hex string', async () => {
    const entity = createEntity({ id: 'f1', role: 'function', displayName: 'foo' });
    const hash = await hashEntity(entity);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same entity produces same hash', async () => {
    const e1 = createEntity({ id: 'f1', role: 'function', displayName: 'foo', updatedAt: 1000 });
    const e2 = createEntity({ id: 'f1', role: 'function', displayName: 'foo', updatedAt: 1000 });
    expect(await hashEntity(e1)).toBe(await hashEntity(e2));
  });

  it('different entities produce different hashes', async () => {
    const e1 = createEntity({ id: 'f1', role: 'function', displayName: 'foo', updatedAt: 1000 });
    const e2 = createEntity({ id: 'f2', role: 'function', displayName: 'bar', updatedAt: 1000 });
    expect(await hashEntity(e1)).not.toBe(await hashEntity(e2));
  });
});
