/**
 * Warm Tier — the 150ms context layer.
 *
 * Tracks: visible entities, recently-changed entities, panel layout.
 * Updated async on debounced events.
 */

import type { WarmSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity, SpatialBounds } from '@usir/protocol/entities';

export class WarmTier {
  public visible: Map<string, SemanticEntity> = new Map();
  public recentlyChanged: Array<{ entity: SemanticEntity; delta: Record<string, unknown> }> = [];
  public panelLayout: Array<{ panelId: string; kind: string; bounds: SpatialBounds }> = [];

  private onUpdate: () => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  public setVisible(entities: SemanticEntity[]): void {
    this.visible.clear();
    for (const e of entities) this.visible.set(e.id, e);
    this.scheduleUpdate();
  }

  public recordChange(entity: SemanticEntity, delta: Record<string, unknown>): void {
    this.recentlyChanged.push({ entity, delta });
    if (this.recentlyChanged.length > 100) this.recentlyChanged.shift();
    this.scheduleUpdate();
  }

  public setPanelLayout(panels: Array<{ panelId: string; kind: string; bounds: SpatialBounds }>): void {
    this.panelLayout = panels;
    this.scheduleUpdate();
  }

  public toSnapshot(): WarmSnapshot {
    return {
      tier: 'warm',
      visible: Array.from(this.visible.values()),
      recentlyChanged: this.recentlyChanged.slice(-20),
      panelLayout: this.panelLayout,
      capturedAt: Date.now(),
      latencyBudgetMs: 150,
    };
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 150);
  }
}
