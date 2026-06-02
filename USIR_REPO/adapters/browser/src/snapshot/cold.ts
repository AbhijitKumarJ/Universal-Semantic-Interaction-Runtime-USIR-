import type { ColdSnapshot } from '@usir/protocol/snapshot';
import { createSemanticGraph, addEntity, type SemanticGraph } from '@usir/protocol/graph';
import type { SemanticEntity } from '@usir/protocol/entities';

export class BrowserColdTier {
  private graph: SemanticGraph = createSemanticGraph();
  private updateScheduled = false;
  private maxDepth: number = 5;

  constructor(private onUpdate: () => void) {}

  public addEntity(entity: SemanticEntity): void {
    addEntity(this.graph, entity);
    this.scheduleUpdate();
  }

  public setEntities(entities: SemanticEntity[]): void {
    this.graph = createSemanticGraph();
    for (const entity of entities) {
      addEntity(this.graph, entity);
    }
    this.scheduleUpdate();
  }

  public toSnapshot(): ColdSnapshot {
    return {
      tier: 'cold',
      graph: this.graph,
      lspMetadata: {},
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
