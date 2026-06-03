import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserWarmTier } from './warm';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'ui_region', displayName: id });
}

describe('BrowserWarmTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty state', () => {
    const tier = new BrowserWarmTier(onUpdate);
    expect(tier.visible.size).toBe(0);
    expect(tier.recentlyChanged).toEqual([]);
    expect(tier.viewportSize).toEqual({ width: 0, height: 0 });
  });

  it('setVisible replaces all visible entities', () => {
    const tier = new BrowserWarmTier(onUpdate);
    tier.setVisible([entity('e1'), entity('e2')]);
    expect(tier.visible.size).toBe(2);
    tier.setVisible([entity('e1')]);
    expect(tier.visible.size).toBe(1);
  });

  it('recordChange appends to recentlyChanged', () => {
    const tier = new BrowserWarmTier(onUpdate);
    tier.recordChange(entity('e1'), { text: 'new' });
    expect(tier.recentlyChanged).toHaveLength(1);
    expect(tier.recentlyChanged[0].delta).toEqual({ text: 'new' });
  });

  it('recordChange limits to 100 entries', () => {
    const tier = new BrowserWarmTier(onUpdate);
    for (let i = 0; i < 110; i++) {
      tier.recordChange(entity(`e${i}`), {});
    }
    vi.advanceTimersByTime(150 * 110);
    expect(tier.recentlyChanged.length).toBeLessThanOrEqual(100);
  });

  it('toSnapshot returns correct WarmSnapshot shape', () => {
    const tier = new BrowserWarmTier(onUpdate);
    tier.setVisible([entity('e1')]);
    tier.recordChange(entity('e2'), {});
    vi.advanceTimersByTime(300);
    const snap = tier.toSnapshot();
    expect(snap.tier).toBe('warm');
    expect(snap.visible).toHaveLength(1);
    expect(snap.latencyBudgetMs).toBe(150);
  });

  it('toSnapshot limits recentlyChanged to 20', () => {
    const tier = new BrowserWarmTier(onUpdate);
    for (let i = 0; i < 30; i++) {
      tier.recordChange(entity(`e${i}`), {});
    }
    vi.advanceTimersByTime(150 * 30);
    const snap = tier.toSnapshot();
    expect(snap.recentlyChanged.length).toBe(20);
  });

  it('debounce delays onUpdate by 150ms', () => {
    const tier = new BrowserWarmTier(onUpdate);
    tier.setVisible([entity('e1')]);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple updates within debounce window', () => {
    const tier = new BrowserWarmTier(onUpdate);
    tier.setVisible([entity('e1')]);
    tier.recordChange(entity('e2'), {});
    vi.advanceTimersByTime(150);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
