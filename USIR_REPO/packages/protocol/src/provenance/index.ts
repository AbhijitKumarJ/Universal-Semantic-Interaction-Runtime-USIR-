/**
 * L0.5 Provenance Layer — the missing piece.
 *
 * Every mutation in USIR answers *what* changed (the entity diff) and
 * *which intent* caused it (the IntentEnvelope). But it does not yet answer:
 *   - WHY did this change happen?
 *   - WHO/WHAT authorized it?
 *   - WHAT was the chain of reasoning?
 *   - Can I roll back the entire causal tree, not just one step?
 *
 * This module defines the provenance graph that closes that gap. The
 * USIR invariant: an entity state is meaningless without its provenance
 * chain.
 */

import type { SemanticEntity } from '../entities';
import type { BaseIntent } from '../intents';

/**
 * The type of actor that performed the mutation.
 * Critical for the A2U (Agent-to-USIR) trust model.
 */
export type ProvenanceActor =
  | { type: 'user'; id: string }
  | { type: 'agent'; id: string; parentDelegateIntentId: string; confidence: number }
  | { type: 'system'; id: string; reason: string };

/**
 * The authorization that permitted this mutation.
 * For trust tier 1 actions, authorization = 'delegated' (no human needed).
 * For trust tier 3, authorization = 'approved' with a human approval id.
 */
export type Authorization =
  | { type: 'approved'; approvalIntentId: string; approverId: string; at: number }
  | { type: 'delegated'; delegateIntentId: string; allowedEntityIds?: string[]; constraints?: string[] }
  | { type: 'pending'; awaitingApprovalIntentId: string }
  | { type: 'rejected'; reason: string; at: number };

/**
 * The reasoning that motivated the mutation. This is what makes
 * the provenance graph answer "why", not just "what".
 */
export type Rationale =
  | { type: 'user-requested'; rawInput: string; interpretedIntent: string }
  | { type: 'delegated'; planStep: string; interpretedIntent: string }
  | { type: 'inferred'; rule: string; confidence: number }
  | { type: 'system'; reason: string };

/**
 * A single provenance node — one mutation in the history of an entity.
 *
 * The whole entity's history is the linked list of these nodes back to
 * the genesis (causalParents is empty).
 */
export interface ProvenanceNode {
  /** Unique provenance id (URN: "provenance://<nodeId>") */
  provenanceId: string;
  /** The intent that caused this mutation */
  intentId: string;
  /** Snapshot of the intent at the time of execution */
  intentSnapshot: BaseIntent;
  /** Who/what performed the mutation */
  actor: ProvenanceActor;
  /** Why this mutation happened */
  rationale: Rationale;
  /** The authorization chain that permitted it */
  authorization: Authorization;
  /** Causal parents — other provenance nodes that led to this one */
  causalParents: string[];
  /** When this happened (epoch ms) */
  timestamp: number;
  /** Hash of the target entity's state immediately before this mutation */
  contentHashBefore: string;
  /** Hash of the target entity's state immediately after this mutation */
  contentHashAfter: string;
  /** The actual diff (semantic, not text) */
  semanticDiff: SemanticDiff;
  /** Optional cryptographic signature for non-repudiation */
  signature?: string;
}

export interface SemanticDiff {
  entityId: string;
  entityBefore: Partial<SemanticEntity>;
  entityAfter: Partial<SemanticEntity>;
  /** Field-level changes */
  changedFields: Array<{
    field: string;
    before: unknown;
    after: unknown;
    /** If this is a relation change, which edges */
    kind: 'attribute' | 'relation_added' | 'relation_removed' | 'spatial' | 'audio';
  }>;
}

/**
 * The complete provenance graph for one or more entities.
 */
export interface ProvenanceGraph {
  nodes: Map<string, ProvenanceNode>;
  /** Index from entity id → list of provenance nodes affecting it */
  byEntity: Map<string, string[]>;
  /** Index from intent id → provenance node */
  byIntent: Map<string, string>;
  /** Index from actor id → provenance nodes they caused */
  byActor: Map<string, string[]>;
  capturedAt: number;
}

export function createProvenanceGraph(): ProvenanceGraph {
  return {
    nodes: new Map(),
    byEntity: new Map(),
    byIntent: new Map(),
    byActor: new Map(),
    capturedAt: Date.now(),
  };
}

export function recordProvenance(graph: ProvenanceGraph, node: ProvenanceNode): void {
  graph.nodes.set(node.provenanceId, node);
  // Index by entity — the diff's entityId
  const entityIds = new Set<string>();
  for (const change of node.semanticDiff.changedFields) {
    if (change.kind === 'relation_added' || change.kind === 'relation_removed') {
      // Also index relations
      const targetId = (change.after ?? change.before) as string;
      if (typeof targetId === 'string') entityIds.add(targetId);
    }
  }
  entityIds.add(node.semanticDiff.entityId);
  for (const entityId of entityIds) {
    if (!graph.byEntity.has(entityId)) graph.byEntity.set(entityId, []);
    graph.byEntity.get(entityId)!.push(node.provenanceId);
  }
  graph.byIntent.set(node.intentId, node.provenanceId);
  const actorId = node.actor.type === 'agent' ? `agent:${node.actor.id}` : `${node.actor.type}:${node.actor.id}`;
  if (!graph.byActor.has(actorId)) graph.byActor.set(actorId, []);
  graph.byActor.get(actorId)!.push(node.provenanceId);
  graph.capturedAt = Date.now();
}

/**
 * Walk the causal chain back to its root. Returns the genesis node(s).
 * Used to answer "why does this entity have its current state?"
 */
export function walkCausalChain(graph: ProvenanceGraph, startNodeId: string): ProvenanceNode[] {
  const visited = new Set<string>();
  const chain: ProvenanceNode[] = [];
  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (!node) continue;
    chain.push(node);
    for (const parentId of node.causalParents) {
      if (!visited.has(parentId)) queue.push(parentId);
    }
  }
  return chain.reverse();
}

/**
 * Compute a stable content hash for an entity. Used in ProvenanceNode
 * to make state changes verifiable and replayable.
 *
 * Works in both Node.js (uses node:crypto) and browser (uses SubtleCrypto).
 */
export async function hashEntity(entity: SemanticEntity): Promise<string> {
  const json = JSON.stringify(entity, Object.keys(entity).sort());
  // Browser/edge environment
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const data = new TextEncoder().encode(json);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node.js fallback
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(json).digest('hex');
}
