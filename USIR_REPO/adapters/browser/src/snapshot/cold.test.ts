import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserColdTier } from './cold';
import { createEntity } from '@usir/protocol/entities';

function entity(id: string) {
  return createEntity({ id, role: 'ui_region', displayName: id });
}

describe('BrowserColdTier', () => {
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty graph', () => {
    const tier = new BrowserColdTier(onUpdate);
    expect(tier.exportGraph().nodes.size).toBe(0);
  });

  it('addEntity adds to graph and schedules update', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    expect(tier.exportGraph().nodes.has('e1')).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('setEntities replaces the entire graph', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    tier.setEntities([entity('e2'), entity('e3')]);
    vi.advanceTimersByTime(1000);
    const graph = tier.exportGraph();
    expect(graph.nodes.has('e1')).toBe(false);
    expect(graph.nodes.has('e2')).toBe(true);
    expect(graph.nodes.has('e3')).toBe(true);
  });

  it('toSnapshot returns correct ColdSnapshot shape', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    vi.advanceTimersByTime(1000);
    const snap = tier.toSnapshot();
    expect(snap.tier).toBe('cold');
    expect(snap.graph.nodes.size).toBe(1);
    expect(snap.lspMetadata).toEqual({});
    expect(snap.latencyBudgetMs).toBe(5000);
  });

  it('debounce schedules update with 1000ms delay', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    vi.advanceTimersByTime(1000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple addEntity within debounce window', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    tier.addEntity(entity('e2'));
    vi.advanceTimersByTime(1000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('exportGraph returns the internal graph', () => {
    const tier = new BrowserColdTier(onUpdate);
    tier.addEntity(entity('e1'));
    const graph = tier.exportGraph();
    expect(graph.nodes.get('e1')).toBeDefined();
  });
});
