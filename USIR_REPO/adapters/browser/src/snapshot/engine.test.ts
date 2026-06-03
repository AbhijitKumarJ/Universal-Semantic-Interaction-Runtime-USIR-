import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserSnapshotEngine } from './engine';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'ui_region', displayName: id });
}

describe('BrowserSnapshotEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates tiers with no initial entity', () => {
    const engine = new BrowserSnapshotEngine();
    expect(engine.hot.activeEntity).toBeNull();
  });

  it('creates tiers with initial entity', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    expect(engine.hot.activeEntity?.id).toBe('e1');
  });

  it('assemble returns full snapshot with all tiers', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    const snap = engine.assemble(true);
    expect(snap.hot.tier).toBe('hot');
    expect(snap.warm.tier).toBe('warm');
    expect(snap.cold?.tier).toBe('cold');
    expect(snap.source).toBe('browser');
  });

  it('assemble excludes cold by default', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    const snap = engine.assemble();
    expect(snap.cold).toBeUndefined();
  });

  it('hotOnly returns snapshot without cold tier', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    const snap = engine.hotOnly();
    expect(snap.cold).toBeUndefined();
    expect(snap.warm.visible).toEqual([]);
  });

  it('version starts at 0', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    expect(engine.getVersion()).toBe(0);
  });

  it('version bumps on hot tier update', () => {
    const engine = new BrowserSnapshotEngine(entity('e1'));
    engine.hot.updatePointer(0, 0, null);
    vi.advanceTimersByTime(16);
    expect(engine.getVersion()).toBe(1);
  });

  it('version bumps on warm tier update', () => {
    const engine = new BrowserSnapshotEngine();
    engine.warm.setVisible([entity('e2')]);
    vi.advanceTimersByTime(150);
    expect(engine.getVersion()).toBe(1);
  });

  it('version bumps on cold tier update', () => {
    const engine = new BrowserSnapshotEngine();
    engine.cold.addEntity(entity('e2'));
    vi.advanceTimersByTime(1000);
    expect(engine.getVersion()).toBe(1);
  });
});
