import type { HotSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';
import { createEmptyHotSnapshot } from '@usir/protocol/snapshot';

export interface PointerInfo {
  entityId: string;
  x: number;
  y: number;
}

export class BrowserHotTier {
  public activeEntity: SemanticEntity | null = null;
  public activeRegion: string = 'viewport';
  public selections: SemanticEntity[] = [];
  public pointerPosition: { x: number; y: number } | null = null;
  public hoveredEntityId: string | null = null;
  public scrollPosition: { x: number; y: number } = { x: 0, y: 0 };
  public ephemeral: Array<{ entityId: string; kind: 'click' | 'hover' | 'scroll' | 'focus' | 'input'; at: number }> = [];

  private onUpdate: () => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  public updatePointer(x: number, y: number, entityId: string | null): void {
    this.pointerPosition = { x, y };
    this.hoveredEntityId = entityId;
    this.scheduleUpdate();
  }

  public updateScroll(x: number, y: number): void {
    this.scrollPosition = { x, y };
    this.recordEphemeral('window', 'scroll');
    this.scheduleUpdate();
  }

  public updateSelection(entities: SemanticEntity[]): void {
    this.selections = entities;
    this.scheduleUpdate();
  }

  public setActiveEntity(entity: SemanticEntity): void {
    this.activeEntity = entity;
    this.recordEphemeral(entity.id, 'focus');
    this.scheduleUpdate();
  }

  public recordInteraction(entityId: string, kind: 'click' | 'hover' | 'scroll' | 'focus' | 'input'): void {
    this.recordEphemeral(entityId, kind);
    this.scheduleUpdate();
  }

  public toSnapshot(): HotSnapshot {
    const entity = this.activeEntity ?? { id: 'dom://viewport', role: 'ui_region' as const, displayName: 'Viewport', attributes: {}, relations: [], updatedAt: Date.now(), source: 'browser' };
    return createEmptyHotSnapshot(entity, this.activeRegion);
  }

  private recordEphemeral(entityId: string, kind: 'click' | 'hover' | 'scroll' | 'focus' | 'input'): void {
    this.ephemeral.push({ entityId, kind, at: Date.now() });
    if (this.ephemeral.length > 50) this.ephemeral.shift();
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 16);
  }
}
