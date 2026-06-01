/**
 * SnapshotEngine — orchestrates the three tiers.
 *
 * The runtime sees only this object. It exposes a unified SemanticSnapshot
 * even though internally there are three independently-updated tiers.
 *
 * Tiered update strategy:
 * - Hot: every cursor/focus change, debounced to 16ms
 * - Warm: every file/panel change, debounced to 150ms
 * - Cold: every file-system/LSP change, debounced to 1s
 */

import type { SemanticSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';
import { HotTier } from './hot';
import { WarmTier } from './warm';
import { ColdTier } from './cold';

export class SnapshotEngine {
  private version: number = 0;
  private lastAssembledAt: number = 0;
  public hot: HotTier;
  public warm: WarmTier;
  public cold: ColdTier;

  constructor(initialActiveEntity: SemanticEntity) {
    this.hot = new HotTier(initialActiveEntity, () => this.bumpVersion());
    this.warm = new WarmTier(() => this.bumpVersion());
    this.cold = new ColdTier(() => this.bumpVersion());
  }

  /**
   * Assemble the full SemanticSnapshot. Hot is always included;
   * Cold is optional (only included if caller has time to wait).
   */
  public assemble(includeCold: boolean = false): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: this.warm.toSnapshot(),
      cold: includeCold ? this.cold.toSnapshot() : undefined,
      source: 'vscode',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  /**
   * Returns just the hot snapshot — for the LLM's first-wave request.
   * Sub-1ms to assemble.
   */
  public hotOnly(): SemanticSnapshot {
    return {
      hot: this.hot.toSnapshot(),
      warm: { tier: 'warm', visible: [], recentlyChanged: [], panelLayout: [], capturedAt: Date.now(), latencyBudgetMs: 150 },
      cold: undefined,
      source: 'vscode',
      version: this.version,
      assembledAt: Date.now(),
    };
  }

  private bumpVersion(): void {
    this.version++;
    this.lastAssembledAt = Date.now();
  }

  public getVersion(): number {
    return this.version;
  }
}
