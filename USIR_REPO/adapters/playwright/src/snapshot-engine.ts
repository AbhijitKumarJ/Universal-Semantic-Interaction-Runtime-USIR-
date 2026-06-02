import type { SemanticSnapshot, HotSnapshot, WarmSnapshot, ColdSnapshot } from '@usir/protocol/snapshot';
import { createSemanticGraph, addEntity } from '@usir/protocol/graph';
import { createEntity, type SemanticEntity } from '@usir/protocol/entities';
import { DOM_EXTRACTOR_SCRIPT, parseDomResult } from './dom-extractor';
import type { Page } from 'playwright';

export class PlaywrightSnapshotEngine {
  private version: number = 0;
  private page: Page;
  private lastViewportUrl: string = '';

  constructor(page: Page) {
    this.page = page;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  public async captureHot(): Promise<HotSnapshot> {
    const url = this.page.url();
    const title = await this.page.title();
    const entity = createEntity({
      id: `url://${url}`,
      role: 'document',
      displayName: title || url,
      source: 'playwright',
    });
    return {
      tier: 'hot',
      activeRegion: 'viewport',
      activeEntity: entity,
      selections: [],
      ephemeral: [],
      capturedAt: Date.now(),
      latencyBudgetMs: 16,
    };
  }

  public async captureWarm(): Promise<WarmSnapshot> {
    try {
      const raw = await this.page.evaluate(new Function(DOM_EXTRACTOR_SCRIPT) as () => unknown);
      const result = parseDomResult(raw);
      const entities = result.extractViewport.map((e: Record<string, unknown>) => {
        const entity = e as unknown as SemanticEntity;
        entity.source = 'playwright';
        return entity;
      });
      return {
        tier: 'warm',
        visible: entities,
        recentlyChanged: [],
        panelLayout: [],
        capturedAt: Date.now(),
        latencyBudgetMs: 150,
      };
    } catch {
      return {
        tier: 'warm',
        visible: [],
        recentlyChanged: [],
        panelLayout: [],
        capturedAt: Date.now(),
        latencyBudgetMs: 150,
      };
    }
  }

  public async captureCold(): Promise<ColdSnapshot> {
    try {
      const raw = await this.page.evaluate(new Function(DOM_EXTRACTOR_SCRIPT) as () => unknown);
      const result = parseDomResult(raw);
      const graph = createSemanticGraph();
      for (const e of result.extractFull) {
        const entity = e as unknown as SemanticEntity;
        entity.source = 'playwright';
        addEntity(graph, entity);
      }
      return {
        tier: 'cold',
        graph,
        lspMetadata: {},
        capturedAt: Date.now(),
        latencyBudgetMs: 5000,
      };
    } catch {
      const graph = createSemanticGraph();
      return {
        tier: 'cold',
        graph,
        lspMetadata: {},
        capturedAt: Date.now(),
        latencyBudgetMs: 5000,
      };
    }
  }

  public async assemble(includeCold: boolean = false): Promise<SemanticSnapshot> {
    const hot = await this.captureHot();
    const warm = await this.captureWarm();
    const cold = includeCold ? await this.captureCold() : undefined;
    this.version++;
    return {
      hot,
      warm,
      cold,
      source: 'playwright',
      version: this.version,
      assembledAt: Date.now(),
    };
  }
}
