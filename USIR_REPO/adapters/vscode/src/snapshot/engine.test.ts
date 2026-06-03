import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SnapshotEngine } from './engine';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'source_file', displayName: id });
}

describe('SnapshotEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the initial entity in hot tier', () => {
    const engine = new SnapshotEngine(entity('f1'));
    expect(engine.hot.activeEntity.id).toBe('f1');
  });

  it('assemble returns full snapshot with all tiers', () => {
    const engine = new SnapshotEngine(entity('f1'));
    const snap = engine.assemble(true);
    expect(snap.hot.tier).toBe('hot');
    expect(snap.warm.tier).toBe('warm');
    expect(snap.cold?.tier).toBe('cold');
    expect(snap.source).toBe('vscode');
  });

  it('assemble excludes cold by default', () => {
    const engine = new SnapshotEngine(entity('f1'));
    const snap = engine.assemble();
    expect(snap.cold).toBeUndefined();
  });

  it('hotOnly returns snapshot without cold tier', () => {
    const engine = new SnapshotEngine(entity('f1'));
    const snap = engine.hotOnly();
    expect(snap.hot.tier).toBe('hot');
    expect(snap.cold).toBeUndefined();
    expect(snap.warm.visible).toEqual([]);
  });

  it('version starts at 0', () => {
    const engine = new SnapshotEngine(entity('f1'));
    expect(engine.getVersion()).toBe(0);
  });

  it('version bumps when hot tier updates', () => {
    const engine = new SnapshotEngine(entity('f1'));
    engine.hot.updateActiveEntity(entity('f2'));
    vi.advanceTimersByTime(16);
    expect(engine.getVersion()).toBe(1);
  });

  it('version bumps when warm tier updates', () => {
    const engine = new SnapshotEngine(entity('f1'));
    engine.warm.setVisible([entity('f2')]);
    vi.advanceTimersByTime(150);
    expect(engine.getVersion()).toBe(1);
  });

  it('version bumps when cold tier updates', () => {
    const engine = new SnapshotEngine(entity('f1'));
    engine.cold.addEntity(entity('f2'));
    vi.advanceTimersByTime(1000);
    expect(engine.getVersion()).toBe(1);
  });

  it('assemble includes current version', () => {
    const engine = new SnapshotEngine(entity('f1'));
    expect(engine.assemble().version).toBe(0);
    engine.hot.updateActiveEntity(entity('f2'));
    vi.advanceTimersByTime(16);
    expect(engine.assemble().version).toBe(1);
  });

  it('assemble includes assembledAt timestamp', () => {
    const engine = new SnapshotEngine(entity('f1'));
    const snap = engine.assemble();
    expect(typeof snap.assembledAt).toBe('number');
    expect(snap.assembledAt).toBeGreaterThan(0);
  });

  it('hotOnly snapshot has empty warm tier', () => {
    const engine = new SnapshotEngine(entity('f1'));
    engine.warm.setVisible([entity('f2')]);
    vi.advanceTimersByTime(150);
    const snap = engine.hotOnly();
    expect(snap.warm.visible).toEqual([]);
  });
});
