import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserHotTier } from './hot';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'ui_region', displayName: id });
}

describe('BrowserHotTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with null active entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    expect(tier.activeEntity).toBeNull();
  });

  it('setActiveEntity stores the entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.setActiveEntity(entity('e1'));
    expect(tier.activeEntity?.id).toBe('e1');
  });

  it('setActiveEntity records ephemeral focus event', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.setActiveEntity(entity('e1'));
    expect(tier.ephemeral).toHaveLength(1);
    expect(tier.ephemeral[0].kind).toBe('focus');
  });

  it('updatePointer sets pointer position and hovered entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updatePointer(100, 200, 'e1');
    expect(tier.pointerPosition).toEqual({ x: 100, y: 200 });
    expect(tier.hoveredEntityId).toBe('e1');
  });

  it('updatePointer accepts null hovered entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updatePointer(50, 50, null);
    expect(tier.hoveredEntityId).toBeNull();
  });

  it('updateScroll updates scroll position', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updateScroll(300, 400);
    expect(tier.scrollPosition).toEqual({ x: 300, y: 400 });
  });

  it('updateScroll records ephemeral scroll event', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updateScroll(0, 100);
    expect(tier.ephemeral[0].kind).toBe('scroll');
  });

  it('updateSelection stores entities', () => {
    const tier = new BrowserHotTier(onUpdate);
    const sel = [entity('e1')];
    tier.updateSelection(sel);
    expect(tier.selections).toEqual(sel);
  });

  it('recordInteraction records ephemeral event', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.recordInteraction('e1', 'click');
    expect(tier.ephemeral).toHaveLength(1);
    expect(tier.ephemeral[0].kind).toBe('click');
  });

  it('toSnapshot returns HotSnapshot with viewport region when no active entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    const snap = tier.toSnapshot();
    expect(snap.activeEntity.id).toBe('dom://viewport');
    expect(snap.activeRegion).toBe('viewport');
  });

  it('toSnapshot returns HotSnapshot with active entity', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.setActiveEntity(entity('e1'));
    vi.advanceTimersByTime(16);
    const snap = tier.toSnapshot();
    expect(snap.activeEntity.id).toBe('e1');
    expect(snap.activeRegion).toBe('viewport');
  });

  it('debounce delays onUpdate by 16ms', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updatePointer(0, 0, null);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple updates within debounce window', () => {
    const tier = new BrowserHotTier(onUpdate);
    tier.updatePointer(0, 0, null);
    tier.updateScroll(10, 20);
    tier.setActiveEntity(entity('e1'));
    vi.advanceTimersByTime(16);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('ephemeral list caps at 50 entries', () => {
    const tier = new BrowserHotTier(onUpdate);
    for (let i = 0; i < 60; i++) {
      tier.recordInteraction(`e${i}`, 'click');
    }
    vi.advanceTimersByTime(16 * 60);
    expect(tier.ephemeral.length).toBeLessThanOrEqual(50);
  });
});
