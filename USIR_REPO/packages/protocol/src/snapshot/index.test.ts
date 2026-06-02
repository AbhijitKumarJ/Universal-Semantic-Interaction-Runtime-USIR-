import { describe, it, expect } from 'vitest';
import { createEmptyHotSnapshot } from './index';
import { createEntity } from '../entities';

describe('snapshot', () => {
  it('createEmptyHotSnapshot sets correct defaults', () => {
    const entity = createEntity({ id: 'f1', role: 'source_file', displayName: 'main.ts' });
    const hot = createEmptyHotSnapshot(entity, 'editor');
    expect(hot.tier).toBe('hot');
    expect(hot.activeEntity.id).toBe('f1');
    expect(hot.activeRegion).toBe('editor');
    expect(hot.selections).toEqual([]);
    expect(hot.ephemeral).toEqual([]);
    expect(hot.latencyBudgetMs).toBe(16);
    expect(typeof hot.capturedAt).toBe('number');
  });

  it('semantic snapshot type is well-formed', () => {
    const entity = createEntity({ id: 'f1', role: 'source_file', displayName: 'main.ts' });
    const hot = createEmptyHotSnapshot(entity, 'editor');
    expect(hot.tier satisfies 'hot').toBe('hot');
  });
});
