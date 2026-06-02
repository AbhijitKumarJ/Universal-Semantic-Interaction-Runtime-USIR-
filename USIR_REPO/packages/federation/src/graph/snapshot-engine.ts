import type { SemanticGraph } from '@usir/protocol/graph';
import type { SemanticSnapshot, HotSnapshot, WarmSnapshot, ColdSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';
import { createEmptyHotSnapshot } from '@usir/protocol/snapshot';
import type { FederatedGraph } from './federated-graph';

export interface FederatedSnapshotConfig {
  localPeerId: string;
  maxWarmEntities: number;
  maxColdEntities: number;
}

export class FederatedSnapshotEngine {
  private graph: FederatedGraph;
  private config: FederatedSnapshotConfig;
  private lastHot: HotSnapshot | null = null;
  private version = 0;

  constructor(graph: FederatedGraph, config?: Partial<FederatedSnapshotConfig>) {
    this.graph = graph;
    this.config = {
      localPeerId: config?.localPeerId ?? 'local',
      maxWarmEntities: config?.maxWarmEntities ?? 50,
      maxColdEntities: config?.maxColdEntities ?? 500,
    };
  }

  buildHotSnapshot(activeEntity: SemanticEntity, activeRegion: string): HotSnapshot {
    const hot = createEmptyHotSnapshot(activeEntity, activeRegion);
    this.lastHot = hot;
    return hot;
  }

  buildWarmSnapshot(): WarmSnapshot {
    const graph = this.graph.exportGraph();
    const entities = Array.from(graph.nodes.values()).map((n) => n.entity);
    const sorted = entities.sort((a, b) => b.updatedAt - a.updatedAt);
    const visible = sorted.slice(0, this.config.maxWarmEntities);

    const panelLayout = Array.from(graph.byRole.entries())
      .filter(([role]) => ['ui_region', 'panel'].includes(role))
      .slice(0, 20)
      .map(([role, ids]) => ({
        panelId: Array.from(ids)[0] ?? 'unknown',
        kind: role,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }));

    return {
      tier: 'warm',
      visible,
      recentlyChanged: visible.slice(0, 10).map((e) => ({
        entity: e,
        delta: { updatedAt: e.updatedAt },
      })),
      panelLayout,
      capturedAt: Date.now(),
      latencyBudgetMs: 150,
    };
  }

  buildColdSnapshot(): ColdSnapshot {
    const graph = this.graph.exportGraph();
    return {
      tier: 'cold',
      graph: this.trimGraph(graph),
      lspMetadata: {},
      capturedAt: Date.now(),
      latencyBudgetMs: 2000,
    };
  }

  buildFullSnapshot(activeEntity: SemanticEntity, activeRegion: string): SemanticSnapshot {
    this.version++;
    return {
      hot: this.buildHotSnapshot(activeEntity, activeRegion),
      warm: this.buildWarmSnapshot(),
      cold: this.buildColdSnapshot(),
      source: `federation:${this.config.localPeerId}`,
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  private trimGraph(graph: SemanticGraph): SemanticGraph {
    if (graph.nodes.size <= this.config.maxColdEntities) return graph;

    const sorted = Array.from(graph.nodes.entries())
      .sort(([, a], [, b]) => b.entity.updatedAt - a.entity.updatedAt);
    const trimmed = sorted.slice(0, this.config.maxColdEntities);
    const keepIds = new Set(trimmed.map(([id]) => id));

    const out: SemanticGraph = {
      nodes: new Map(),
      edges: [],
      byRole: new Map(),
      bySource: new Map(),
      capturedAt: graph.capturedAt,
      version: graph.version,
    };

    for (const [id, node] of trimmed) {
      out.nodes.set(id, node);
      const role = node.entity.role;
      if (!out.byRole.has(role)) out.byRole.set(role, new Set());
      out.byRole.get(role)!.add(id);
      if (!out.bySource.has(node.entity.source)) out.bySource.set(node.entity.source, new Set());
      out.bySource.get(node.entity.source)!.add(id);
    }

    for (const edge of graph.edges) {
      if (keepIds.has(edge.targetId)) {
        out.edges.push(edge);
      }
    }

    return out;
  }
}
