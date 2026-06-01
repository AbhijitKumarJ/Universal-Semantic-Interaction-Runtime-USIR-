/**
 * Cold Tier — the deep context (LSP, workspace, dependencies).
 *
 * Updated async on file-system events, debounced to seconds.
 * This is the second wave of context sent to the LLM.
 *
 * The BFS-traversal safety pattern is critical: we never load the full
 * semantic graph synchronously. We use depth-limited BFS from the active
 * entity and lazy-load on demand.
 */

import type { ColdSnapshot, LspEntityMetadata } from '@usir/protocol/snapshot';
import { createSemanticGraph, addEntity, bfs, type SemanticGraph } from '@usir/protocol/graph';
import type { SemanticEntity } from '@usir/protocol/entities';

export class ColdTier {
  private graph: SemanticGraph = createSemanticGraph();
  private lspMetadata: Map<string, LspEntityMetadata> = new Map();
  private updateScheduled = false;
  private maxDepth: number = 3;

  constructor(private onUpdate: () => void) {}

  public addEntity(entity: SemanticEntity, metadata?: LspEntityMetadata): void {
    addEntity(this.graph, entity);
    if (metadata) this.lspMetadata.set(entity.id, metadata);
    this.scheduleUpdate();
  }

  public removeEntity(entityId: string): void {
    // We need to import the removeEntity function
    import('@usir/protocol/graph').then(({ removeEntity }) => {
      removeEntity(this.graph, entityId);
      this.lspMetadata.delete(entityId);
      this.scheduleUpdate();
    });
  }

  /**
   * Get a sub-graph rooted at the active entity, BFS up to maxDepth.
   * This is the "projection" used when the LLM needs context about
   * the file the user is working on.
   */
  public projectSubgraph(rootId: string, maxDepth?: number): SemanticEntity[] {
    const depth = maxDepth ?? this.maxDepth;
    const out: SemanticEntity[] = [];
    bfs(this.graph, rootId, depth, (id) => {
      const node = this.graph.nodes.get(id);
      if (node) out.push(node.entity);
    });
    return out;
  }

  public getLspMetadata(entityId: string): LspEntityMetadata | undefined {
    return this.lspMetadata.get(entityId);
  }

  public toSnapshot(): ColdSnapshot {
    return {
      tier: 'cold',
      graph: this.graph,
      lspMetadata: Object.fromEntries(this.lspMetadata),
      capturedAt: Date.now(),
      latencyBudgetMs: 5000,
    };
  }

  public exportGraph(): SemanticGraph {
    return this.graph;
  }

  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    setTimeout(() => {
      this.updateScheduled = false;
      this.onUpdate();
    }, 1000);
  }
}
