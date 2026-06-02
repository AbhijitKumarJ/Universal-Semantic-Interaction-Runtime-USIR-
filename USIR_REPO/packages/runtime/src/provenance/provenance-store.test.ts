import { describe, it, expect } from 'vitest';
import { ProvenanceStore } from './provenance-store';
import { createEntity } from '@usir/protocol/entities';
import type { SemanticEntity } from '@usir/protocol/entities';

const dummyEntity = (id: string, name: string): SemanticEntity =>
  createEntity({ id, role: 'function', displayName: name });

describe('ProvenanceStore', () => {
  it('starts empty', () => {
    const store = new ProvenanceStore();
    expect(store.exportGraph().nodes.size).toBe(0);
  });

  it('records a mutation', async () => {
    const store = new ProvenanceStore();
    const before = dummyEntity('f1', 'oldName');
    const after = dummyEntity('f1', 'newName');
    const node = await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'rename', interpretedIntent: 'edit' },
      authorization: { type: 'delegated', delegateIntentId: 'int-1' },
      entityBefore: before,
      entityAfter: after,
      causalParents: [],
    });
    expect(node.provenanceId).toMatch(/^prov-/);
    expect(node.semanticDiff.entityId).toBe('f1');
    expect(node.semanticDiff.changedFields.some((f) => f.field === 'displayName')).toBe(true);
  });

  it('explainHistory returns causal chain', async () => {
    const store = new ProvenanceStore();
    const original = dummyEntity('f1', 'original');
    const renamed = dummyEntity('f1', 'renamed');
    const node1 = await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'rename', interpretedIntent: 'edit' },
      authorization: { type: 'delegated', delegateIntentId: 'int-1' },
      entityBefore: original,
      entityAfter: renamed,
      causalParents: [],
    });
    const history = store.explainHistory('f1');
    expect(history).toHaveLength(1);
    expect(history[0].provenanceId).toBe(node1.provenanceId);
  });

  it('approve transitions pending to approved', async () => {
    const store = new ProvenanceStore();
    const before = dummyEntity('f1', 'old');
    const after = dummyEntity('f1', 'new');
    const node = await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'edit', interpretedIntent: 'edit' },
      authorization: { type: 'pending', awaitingApprovalIntentId: 'int-1' },
      entityBefore: before,
      entityAfter: after,
      causalParents: [],
    });
    const approved = store.approve(node.provenanceId, 'approve-1', 'admin');
    expect(approved).not.toBeNull();
    expect(approved!.authorization.type).toBe('approved');
  });

  it('reject transitions pending to rejected', async () => {
    const store = new ProvenanceStore();
    const before = dummyEntity('f1', 'old');
    const after = dummyEntity('f1', 'new');
    const node = await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'edit', interpretedIntent: 'edit' },
      authorization: { type: 'pending', awaitingApprovalIntentId: 'int-1' },
      entityBefore: before,
      entityAfter: after,
      causalParents: [],
    });
    const rejected = store.reject(node.provenanceId, 'not needed');
    expect(rejected).not.toBeNull();
    expect(rejected!.authorization.type).toBe('rejected');
  });

  it('approve/reject return null for non-pending nodes', () => {
    const store = new ProvenanceStore();
    expect(store.approve('nonexistent', 'a1', 'u1')).toBeNull();
    expect(store.reject('nonexistent', 'reason')).toBeNull();
  });

  it('listPending returns only pending nodes', async () => {
    const store = new ProvenanceStore();
    const before = dummyEntity('f1', 'old');
    const after = dummyEntity('f1', 'new');
    await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'edit', interpretedIntent: 'edit' },
      authorization: { type: 'pending', awaitingApprovalIntentId: 'int-1' },
      entityBefore: before,
      entityAfter: after,
      causalParents: [],
    });
    expect(store.listPending()).toHaveLength(1);
  });

  it('listByActor returns nodes for a given actor', async () => {
    const store = new ProvenanceStore();
    const before = dummyEntity('f1', 'old');
    const after = dummyEntity('f1', 'new');
    await store.record({
      intent: { type: 'intent.manipulation.edit', intentId: 'int-1', timestamp: Date.now(), actor: { type: 'user', id: 'u1' }, confidence: 1 },
      actor: { type: 'user', id: 'u1' },
      rationale: { type: 'user-requested', rawInput: 'edit', interpretedIntent: 'edit' },
      authorization: { type: 'delegated', delegateIntentId: 'int-1' },
      entityBefore: before,
      entityAfter: after,
      causalParents: [],
    });
    expect(store.listByActor('user:u1')).toHaveLength(1);
    expect(store.listByActor('user:nobody')).toHaveLength(0);
  });
});
