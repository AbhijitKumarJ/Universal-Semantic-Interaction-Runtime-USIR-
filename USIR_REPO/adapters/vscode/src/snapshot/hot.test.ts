import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HotTier } from './hot';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string, name?: string) {
  return createEntity({ id, role: 'source_file', displayName: name ?? id });
}

describe('HotTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the initial active entity', () => {
    const e = entity('f1', 'main.ts');
    const tier = new HotTier(e, onUpdate);
    expect(tier.activeEntity.id).toBe('f1');
    expect(tier.activeEntity.displayName).toBe('main.ts');
  });

  it('sets default region to editor', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    expect(tier.activeRegion).toBe('editor');
  });

  it('updateActiveEntity changes the entity and region', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateActiveEntity(entity('f2', 'bar.ts'), 'terminal');
    expect(tier.activeEntity.id).toBe('f2');
    expect(tier.activeRegion).toBe('terminal');
  });

  it('updateActiveEntity records an ephemeral open event', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateActiveEntity(entity('f2'), 'editor');
    expect(tier.ephemeral).toHaveLength(1);
    expect(tier.ephemeral[0].kind).toBe('open');
    expect(tier.ephemeral[0].entityId).toBe('f2');
  });

  it('updateSelection stores entities and records ephemeral', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    const sel = [entity('f2')];
    tier.updateSelection(sel);
    expect(tier.selections).toEqual(sel);
    expect(tier.ephemeral).toHaveLength(1);
    expect(tier.ephemeral[0].kind).toBe('select');
  });

  it('updateSelection does not record ephemeral for empty selection', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateSelection([]);
    expect(tier.ephemeral).toHaveLength(0);
  });

  it('updatePointerTarget stores the target', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    const target = { entityId: 'f2', bounds: { x: 1, y: 2, width: 10, height: 20 } };
    tier.updatePointerTarget(target);
    expect(tier.pointerTarget).toEqual(target);
  });

  it('toSnapshot returns correct HotSnapshot shape', () => {
    const e = entity('f1', 'app.ts');
    const tier = new HotTier(e, onUpdate);
    const snap = tier.toSnapshot();
    expect(snap.tier).toBe('hot');
    expect(snap.activeEntity.id).toBe('f1');
    expect(snap.activeRegion).toBe('editor');
    expect(snap.latencyBudgetMs).toBe(16);
    expect(typeof snap.capturedAt).toBe('number');
  });

  it('debounce delays onUpdate by 16ms', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateActiveEntity(entity('f2'));
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple updates within debounce window', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateActiveEntity(entity('f2'));
    tier.updateSelection([entity('f3')]);
    tier.updatePointerTarget({ entityId: 'f4', bounds: { x: 0, y: 0, width: 1, height: 1 } });
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('ephemeral list caps at 50 entries', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    for (let i = 0; i < 60; i++) {
      tier.updateActiveEntity(entity(`e${i}`));
    }
    vi.advanceTimersByTime(16 * 60);
    expect(tier.ephemeral.length).toBeLessThanOrEqual(50);
  });

  it('ephemeral tracks most recent entries', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    for (let i = 0; i < 55; i++) {
      tier.updateActiveEntity(entity(`e${i}`));
    }
    vi.advanceTimersByTime(16 * 55);
    expect(tier.ephemeral[0].entityId).toBe('e5');
  });

  it('calls onUpdate after debounce on updateActiveEntity', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateActiveEntity(entity('f2'));
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('calls onUpdate after debounce on updateSelection', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updateSelection([entity('f2')]);
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('calls onUpdate after debounce on updatePointerTarget', () => {
    const tier = new HotTier(entity('f1'), onUpdate);
    tier.updatePointerTarget({ entityId: 'f2', bounds: { x: 0, y: 0, width: 1, height: 1 } });
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});
