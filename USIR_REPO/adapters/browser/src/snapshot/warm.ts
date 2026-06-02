import type { WarmSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';

export class BrowserWarmTier {
  public visible: Map<string, SemanticEntity> = new Map();
  public recentlyChanged: Array<{ entity: SemanticEntity; delta: Record<string, unknown> }> = [];
  public viewportSize: { width: number; height: number } = { width: 0, height: 0 };

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

  public toSnapshot(): WarmSnapshot {
    return {
      tier: 'warm',
      visible: Array.from(this.visible.values()),
      recentlyChanged: this.recentlyChanged.slice(-20),
      panelLayout: [],
      capturedAt: Date.now(),
      latencyBudgetMs: 150,
    };
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 150);
  }
}
