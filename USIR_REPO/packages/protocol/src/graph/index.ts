/**
 * Semantic Graph — the typed graph that adapters emit and the runtime queries.
 *
 * Screens are hierarchies (trees). Human tasks are relationships (graphs).
 * This is the actual graph representation, on top of which intents operate.
 */

import type { SemanticEntity, EntityRelation } from '../entities';

export interface SemanticNode {
  entity: SemanticEntity;
  /** Adjacency list for fast lookup */
  outbound: string[];
  inbound: string[];
}

export interface SemanticGraph {
  /** All nodes keyed by entity id */
  nodes: Map<string, SemanticNode>;
  /** All edges with full relation metadata */
  edges: EntityRelation[];
  /** Index by role for fast role-based queries */
  byRole: Map<string, Set<string>>;
  /** Index by source adapter */
  bySource: Map<string, Set<string>>;
  /** Captured-at timestamp (epoch ms) — used for stale-data detection */
  capturedAt: number;
  /** Graph version — incremented on each adapter snapshot */
  version: number;
}

export function createSemanticGraph(): SemanticGraph {
  return {
    nodes: new Map(),
    edges: [],
    byRole: new Map(),
    bySource: new Map(),
    capturedAt: Date.now(),
    version: 0,
  };
}

export function addEntity(graph: SemanticGraph, entity: SemanticEntity): void {
  graph.nodes.set(entity.id, {
    entity,
    outbound: [],
    inbound: [],
  });
  // Role index
  if (!graph.byRole.has(entity.role)) {
    graph.byRole.set(entity.role, new Set());
  }
  graph.byRole.get(entity.role)!.add(entity.id);
  // Source index
  if (!graph.bySource.has(entity.source)) {
    graph.bySource.set(entity.source, new Set());
  }
  graph.bySource.get(entity.source)!.add(entity.id);
  // Edges
  for (const rel of entity.relations) {
    graph.edges.push(rel);
    const sourceNode = graph.nodes.get(entity.id);
    const targetNode = graph.nodes.get(rel.targetId);
    if (sourceNode) sourceNode.outbound.push(rel.targetId);
    if (targetNode) targetNode.inbound.push(entity.id);
  }
  graph.capturedAt = Date.now();
  graph.version += 1;
}

export function removeEntity(graph: SemanticGraph, entityId: string): void {
  const node = graph.nodes.get(entityId);
  if (!node) return;
  graph.byRole.get(node.entity.role)?.delete(entityId);
  graph.bySource.get(node.entity.source)?.delete(entityId);
  // Remove edges
  graph.edges = graph.edges.filter(
    (e) => e.targetId !== entityId,
  );
  // Clean up adjacency
  for (const other of graph.nodes.values()) {
    other.outbound = other.outbound.filter((id) => id !== entityId);
    other.inbound = other.inbound.filter((id) => id !== entityId);
  }
  graph.nodes.delete(entityId);
  graph.capturedAt = Date.now();
  graph.version += 1;
}

/**
 * BFS traversal up to a depth limit. Critical for the Tiered Snapshot Engine
 * — we must never walk the full graph on the UI thread.
 */
export function bfs(
  graph: SemanticGraph,
  startId: string,
  maxDepth: number,
  visitor: (entityId: string, depth: number) => boolean | void,
): void {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (visitor(id, depth) === false) return;
    if (depth >= maxDepth) continue;
    const node = graph.nodes.get(id);
    if (!node) continue;
    for (const outbound of node.outbound) {
      if (!visited.has(outbound)) {
        queue.push({ id: outbound, depth: depth + 1 });
      }
    }
  }
}

/**
 * Find entities matching a predicate. Used by the Intent Router to
 * build candidate lists for LLM disambiguation.
 */
export function findEntities(
  graph: SemanticGraph,
  predicate: (entity: SemanticEntity) => boolean,
): SemanticEntity[] {
  const out: SemanticEntity[] = [];
  for (const node of graph.nodes.values()) {
    if (predicate(node.entity)) out.push(node.entity);
  }
  return out;
}
