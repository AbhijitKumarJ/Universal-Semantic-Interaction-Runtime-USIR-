import type { SemanticSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';
import { BrowserHotTier } from './hot';
import { BrowserWarmTier } from './warm';
import { BrowserColdTier } from './cold';

export class BrowserSnapshotEngine {
  private version: number = 0;
  public hot: BrowserHotTier;
  public warm: BrowserWarmTier;
  public cold: BrowserColdTier;

  constructor(initialEntity?: SemanticEntity) {
    this.hot = new BrowserHotTier(() => this.bumpVersion());
    this.warm = new BrowserWarmTier(() => this.bumpVersion());
    this.cold = new BrowserColdTier(() => this.bumpVersion());
    if (initialEntity) {
      this.hot.setActiveEntity(initialEntity);
    }
  }

  public assemble(includeCold: boolean = false): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: this.warm.toSnapshot(),
      cold: includeCold ? this.cold.toSnapshot() : undefined,
      source: 'browser',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  public hotOnly(): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: { tier: 'warm', visible: [], recentlyChanged: [], panelLayout: [], capturedAt: Date.now(), latencyBudgetMs: 150 },
      cold: undefined,
      source: 'browser',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  private bumpVersion(): void {
    this.version++;
  }

  public getVersion(): number {
    return this.version;
  }
}
