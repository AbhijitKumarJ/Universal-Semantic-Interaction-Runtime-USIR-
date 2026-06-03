/**
 * Provenance Store — persists the L0.5 provenance graph.
 *
 * In-memory implementation for the MVP. Real implementation would back
 * this with a durable store (SQLite, RocksDB, or a graph database).
 */

import {
  createProvenanceGraph,
  recordProvenance,
  walkCausalChain,
  hashEntity,
  type ProvenanceGraph,
  type ProvenanceNode,
  type ProvenanceActor,
  type Authorization,
  type Rationale,
  type SemanticDiff,
} from '@usir/protocol/provenance';
import type { SemanticEntity } from '@usir/protocol/entities';
import type { BaseIntent } from '@usir/protocol/intents';
import { saveJSON, loadJSON, type Persistable } from '../persist';

export interface ProvenanceStoreData {
  nodes: Array<[string, ProvenanceNode]>;
  byEntity: Array<[string, string[]]>;
  byIntent: Array<[string, string]>;
  byActor: Array<[string, string[]]>;
  capturedAt: number;
}

export class ProvenanceStore implements Persistable<ProvenanceStoreData> {
  private graph: ProvenanceGraph = createProvenanceGraph();

  public toJSON(): ProvenanceStoreData {
    return {
      nodes: [...this.graph.nodes.entries()],
      byEntity: [...this.graph.byEntity.entries()],
      byIntent: [...this.graph.byIntent.entries()],
      byActor: [...this.graph.byActor.entries()],
      capturedAt: this.graph.capturedAt,
    };
  }

  public fromJSON(data: ProvenanceStoreData): void {
    this.graph = {
      nodes: new Map(data.nodes ?? []),
      byEntity: new Map(data.byEntity ?? []),
      byIntent: new Map(data.byIntent ?? []),
      byActor: new Map(data.byActor ?? []),
      capturedAt: data.capturedAt ?? Date.now(),
    };
  }

  public save(path: string): void {
    saveJSON(path, this.toJSON());
  }

  public load(path: string): boolean {
    const data = loadJSON<ProvenanceStoreData>(path);
    if (!data) return false;
    this.fromJSON(data);
    return true;
  }

  /**
   * Record a mutation. Called by the executor after every successful step.
   */
  public async record(args: {
    intent: BaseIntent;
    actor: ProvenanceActor;
    rationale: Rationale;
    authorization: Authorization;
    entityBefore: SemanticEntity;
    entityAfter: SemanticEntity;
    causalParents: string[];
  }): Promise<ProvenanceNode> {
    const [hashBefore, hashAfter] = await Promise.all([
      hashEntity(args.entityBefore),
      hashEntity(args.entityAfter),
    ]);
    const semanticDiff = this.computeDiff(args.entityBefore, args.entityAfter);
    const node: ProvenanceNode = {
      provenanceId: `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      intentId: args.intent.intentId,
      intentSnapshot: args.intent,
      actor: args.actor,
      rationale: args.rationale,
      authorization: args.authorization,
      causalParents: args.causalParents,
      timestamp: Date.now(),
      contentHashBefore: hashBefore,
      contentHashAfter: hashAfter,
      semanticDiff,
    };
    recordProvenance(this.graph, node);
    return node;
  }

  /**
   * Answer "why does this entity have its current state?"
   * Returns the chain of mutations back to genesis.
   */
  public explainHistory(entityId: string): ProvenanceNode[] {
    const provenanceIds = this.graph.byEntity.get(entityId) ?? [];
    if (provenanceIds.length === 0) return [];
    const latest = provenanceIds[provenanceIds.length - 1]!;
    return walkCausalChain(this.graph, latest);
  }

  /**
   * List all mutations performed by a given actor.
   */
  public listByActor(actorId: string): ProvenanceNode[] {
    const ids = this.graph.byActor.get(actorId) ?? [];
    return ids.map((id) => this.graph.nodes.get(id)!).filter(Boolean);
  }

  /**
   * List all mutations pending approval.
   */
  public listPending(): ProvenanceNode[] {
    return Array.from(this.graph.nodes.values()).filter(
      (n) => n.authorization.type === 'pending',
    );
  }

  /**
   * Approve a pending mutation. Returns the updated node.
   */
  public approve(provenanceId: string, approvalIntentId: string, approverId: string): ProvenanceNode | null {
    const node = this.graph.nodes.get(provenanceId);
    if (!node || node.authorization.type !== 'pending') return null;
    node.authorization = {
      type: 'approved',
      approvalIntentId,
      approverId,
      at: Date.now(),
    };
    return node;
  }

  /**
   * Reject a pending mutation.
   */
  public reject(provenanceId: string, reason: string): ProvenanceNode | null {
    const node = this.graph.nodes.get(provenanceId);
    if (!node || node.authorization.type !== 'pending') return null;
    node.authorization = { type: 'rejected', reason, at: Date.now() };
    return node;
  }

  public exportGraph(): ProvenanceGraph {
    return this.graph;
  }

  private computeDiff(before: SemanticEntity, after: SemanticEntity): SemanticDiff {
    const changedFields: SemanticDiff['changedFields'] = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      const beforeVal = (before as any)[key];
      const afterVal = (after as any)[key];
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        let kind: SemanticDiff['changedFields'][number]['kind'] = 'attribute';
        if (key === 'relations') {
          kind = 'relation_added'; // simplified; should diff sets
        } else if (key === 'spatial') {
          kind = 'spatial';
        } else if (key === 'audioFingerprint') {
          kind = 'audio';
        }
        changedFields.push({ field: key, before: beforeVal, after: afterVal, kind });
      }
    }
    return {
      entityId: after.id,
      entityBefore: before,
      entityAfter: after,
      changedFields,
    };
  }
}
