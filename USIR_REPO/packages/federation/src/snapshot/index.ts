import type { SemanticGraph } from '@usir/protocol/graph';

export type FederatedPatchOp =
  | 'addEntity'
  | 'removeEntity'
  | 'updateEntity'
  | 'addEdge'
  | 'removeEdge'
  | 'updateVersion'
  | 'fullSnapshot';

export interface FederatedPatch {
  op: FederatedPatchOp;
  entityId?: string;
  serializedEntity?: string;
  changedFields?: Array<{ field: string; value: unknown }>;
  sourceId?: string;
  targetId?: string;
  kind?: string;
  version?: number;
  serializedGraph?: string;
}

export interface FederatedSnapshotDiff {
  baseVersion: number;
  targetVersion: number;
  patches: FederatedPatch[];
  capturedAt: number;
  sourcePeerId: string;
}

export interface FederatedGraphMeta {
  version: number;
  nodeCount: number;
  edgeCount: number;
  lastMutatedAt: number;
}

export function computeDiff(
  from: SemanticGraph,
  to: SemanticGraph,
  sourcePeerId: string,
): FederatedSnapshotDiff {
  const patches: FederatedPatch[] = [];

  const fromIds = new Set(from.nodes.keys());
  const toIds = new Set(to.nodes.keys());

  for (const id of toIds) {
    if (!fromIds.has(id)) {
      const entity = to.nodes.get(id)!;
      patches.push({
        op: 'addEntity',
        entityId: id,
        serializedEntity: JSON.stringify(entity.entity),
      });
    }
  }

  for (const id of fromIds) {
    if (!toIds.has(id)) {
      patches.push({ op: 'removeEntity', entityId: id });
    }
  }

  for (const id of toIds) {
    if (fromIds.has(id)) {
      const fromEntity = from.nodes.get(id)!.entity;
      const toEntity = to.nodes.get(id)!.entity;
      const changedFields: Array<{ field: string; value: unknown }> = [];
      for (const key of new Set([...Object.keys(fromEntity), ...Object.keys(toEntity)])) {
        const k = key as keyof typeof fromEntity;
        if (JSON.stringify(fromEntity[k]) !== JSON.stringify(toEntity[k])) {
          changedFields.push({ field: key, value: toEntity[k] });
        }
      }
      if (changedFields.length > 0) {
        patches.push({ op: 'updateEntity', entityId: id, changedFields });
      }
    }
  }

  const fromEdges = new Set(from.edges.map((e) => `${e.kind}:${e.targetId}`));
  const toEdges = new Set(to.edges.map((e) => `${e.kind}:${e.targetId}`));

  for (const edgeKey of toEdges) {
    if (!fromEdges.has(edgeKey)) {
      const [kind, targetId] = edgeKey.split(/:(.+)/);
      patches.push({ op: 'addEdge', sourceId: '', targetId, kind });
    }
  }

  patches.push({ op: 'updateVersion', version: to.version });

  return {
    baseVersion: from.version,
    targetVersion: to.version,
    patches,
    capturedAt: Date.now(),
    sourcePeerId,
  };
}

export function applyDiff(
  graph: SemanticGraph,
  diff: FederatedSnapshotDiff,
): SemanticGraph {
  for (const patch of diff.patches) {
    switch (patch.op) {
      case 'addEntity':
        if (patch.entityId && patch.serializedEntity) {
          const entity = JSON.parse(patch.serializedEntity);
          graph.nodes.set(patch.entityId, {
            entity,
            outbound: [],
            inbound: [],
          });
        }
        break;
      case 'removeEntity':
        if (patch.entityId) {
          graph.nodes.delete(patch.entityId);
        }
        break;
      case 'updateEntity':
        if (patch.entityId && patch.changedFields) {
          const node = graph.nodes.get(patch.entityId);
          if (node) {
            for (const cf of patch.changedFields) {
              (node.entity as unknown as Record<string, unknown>)[cf.field] = cf.value;
            }
          }
        }
        break;
      case 'addEdge':
        if (patch.targetId && patch.kind) {
          const source = graph.nodes.get(patch.sourceId!);
          const target = graph.nodes.get(patch.targetId);
          if (source && target) {
            source.outbound.push(patch.targetId);
            target.inbound.push(patch.sourceId!);
          }
        }
        break;
      case 'removeEdge':
        break;
      case 'updateVersion':
        if (patch.version !== undefined) {
          graph.version = patch.version;
        }
        break;
      case 'fullSnapshot':
        if (patch.serializedGraph) {
          return JSON.parse(patch.serializedGraph);
        }
        break;
    }
  }
  graph.capturedAt = Date.now();
  return graph;
}
