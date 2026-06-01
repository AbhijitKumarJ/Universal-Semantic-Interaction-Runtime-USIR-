/**
 * Hot Tier — the 16ms invocation anchor.
 *
 * Tracks: active editor, cursor position, selection, focused region.
 * Updated synchronously on every cursor/selection/focus change.
 * This is the *first* thing sent to the LLM in any FusedIntent request.
 *
 * The implementation is intentionally minimal: a debounced listener
 * that snapshots only the minimum state needed.
 */

import type { HotSnapshot } from '@usir/protocol/snapshot';
import type { SemanticEntity } from '@usir/protocol/entities';
import { createEmptyHotSnapshot } from '@usir/protocol/snapshot';

export class HotTier {
  public activeEntity: SemanticEntity;
  public activeRegion: string = 'editor';
  public selections: SemanticEntity[] = [];
  public pointerTarget: { entityId: string; bounds: { x: number; y: number; width: number; height: number } } | null = null;
  public ephemeral: Array<{ entityId: string; kind: 'select' | 'edit' | 'open' | 'close'; at: number }> = [];

  private onUpdate: () => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(activeEntity: SemanticEntity, onUpdate: () => void) {
    this.activeEntity = activeEntity;
    this.onUpdate = onUpdate;
  }

  public updateActiveEntity(entity: SemanticEntity, region: string = 'editor'): void {
    this.activeEntity = entity;
    this.activeRegion = region;
    this.recordEphemeral(entity.id, 'open');
    this.scheduleUpdate();
  }

  public updateSelection(entities: SemanticEntity[]): void {
    this.selections = entities;
    if (entities.length > 0) {
      this.recordEphemeral(entities[0]!.id, 'select');
    }
    this.scheduleUpdate();
  }

  public updatePointerTarget(target: { entityId: string; bounds: { x: number; y: number; width: number; height: number } }): void {
    this.pointerTarget = target;
    this.scheduleUpdate();
  }

  public toSnapshot(): HotSnapshot {
    return createEmptyHotSnapshot(this.activeEntity, this.activeRegion);
  }

  private recordEphemeral(entityId: string, kind: 'select' | 'edit' | 'open' | 'close'): void {
    this.ephemeral.push({ entityId, kind, at: Date.now() });
    if (this.ephemeral.length > 50) this.ephemeral.shift();
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onUpdate(), 16);
  }
}
