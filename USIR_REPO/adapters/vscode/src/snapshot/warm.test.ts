import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WarmTier } from './warm';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'source_file', displayName: id });
}

describe('WarmTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty state', () => {
    const tier = new WarmTier(onUpdate);
    expect(tier.visible.size).toBe(0);
    expect(tier.recentlyChanged).toEqual([]);
    expect(tier.panelLayout).toEqual([]);
  });

  it('setVisible replaces all visible entities', () => {
    const tier = new WarmTier(onUpdate);
    const e1 = entity('f1');
    const e2 = entity('f2');
    tier.setVisible([e1, e2]);
    expect(tier.visible.size).toBe(2);
    expect(tier.visible.get('f1')).toEqual(e1);
    tier.setVisible([e1]);
    expect(tier.visible.size).toBe(1);
  });

  it('recordChange appends to recentlyChanged', () => {
    const tier = new WarmTier(onUpdate);
    tier.recordChange(entity('f1'), { lineCount: 42 });
    expect(tier.recentlyChanged).toHaveLength(1);
    expect(tier.recentlyChanged[0].delta).toEqual({ lineCount: 42 });
  });

  it('recordChange limits to 100 entries', () => {
    const tier = new WarmTier(onUpdate);
    for (let i = 0; i < 110; i++) {
      tier.recordChange(entity(`f${i}`), {});
    }
    vi.advanceTimersByTime(150 * 110);
    expect(tier.recentlyChanged.length).toBeLessThanOrEqual(100);
  });

  it('setPanelLayout stores panel layout', () => {
    const tier = new WarmTier(onUpdate);
    const layout = [{ panelId: 'explorer', kind: 'sidebar', bounds: { x: 0, y: 0, width: 300, height: 800 } as any }];
    tier.setPanelLayout(layout);
    expect(tier.panelLayout).toEqual(layout);
  });

  it('toSnapshot returns correct WarmSnapshot shape', () => {
    const tier = new WarmTier(onUpdate);
    tier.setVisible([entity('f1')]);
    tier.recordChange(entity('f2'), {});
    vi.advanceTimersByTime(300);
    const snap = tier.toSnapshot();
    expect(snap.tier).toBe('warm');
    expect(snap.visible).toHaveLength(1);
    expect(snap.latencyBudgetMs).toBe(150);
    expect(typeof snap.capturedAt).toBe('number');
  });

  it('toSnapshot limits recentlyChanged to 20', () => {
    const tier = new WarmTier(onUpdate);
    for (let i = 0; i < 30; i++) {
      tier.recordChange(entity(`f${i}`), {});
    }
    vi.advanceTimersByTime(150 * 30);
    const snap = tier.toSnapshot();
    expect(snap.recentlyChanged.length).toBe(20);
  });

  it('debounce delays onUpdate by 150ms', () => {
    const tier = new WarmTier(onUpdate);
    tier.setVisible([entity('f1')]);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple updates within debounce window', () => {
    const tier = new WarmTier(onUpdate);
    tier.setVisible([entity('f1')]);
    tier.recordChange(entity('f2'), {});
    tier.setPanelLayout([]);
    vi.advanceTimersByTime(150);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onUpdate for recordChange', () => {
    const tier = new WarmTier(onUpdate);
    tier.recordChange(entity('f1'), {});
    vi.advanceTimersByTime(150);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('calls onUpdate for setPanelLayout', () => {
    const tier = new WarmTier(onUpdate);
    tier.setPanelLayout([]);
    vi.advanceTimersByTime(150);
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});
