import { describe, it, expect } from 'vitest';
import { createEntity } from './index';

describe('createEntity', () => {
  it('creates a minimal entity with required fields', () => {
    const entity = createEntity({
      id: 'file:///src/main.ts',
      role: 'source_file',
      displayName: 'main.ts',
    });
    expect(entity.id).toBe('file:///src/main.ts');
    expect(entity.role).toBe('source_file');
    expect(entity.displayName).toBe('main.ts');
    expect(entity.relations).toEqual([]);
    expect(entity.attributes).toEqual({});
    expect(entity.source).toBe('unknown');
    expect(typeof entity.updatedAt).toBe('number');
  });

  it('merges partial fields with defaults', () => {
    const entity = createEntity({
      id: 'file:///src/foo.ts',
      role: 'function',
      displayName: 'foo',
      source: 'vscode',
      attributes: { lineCount: 42 },
    });
    expect(entity.source).toBe('vscode');
    expect(entity.attributes).toEqual({ lineCount: 42 });
    expect(entity.relations).toEqual([]);
  });

  it('accepts relations', () => {
    const entity = createEntity({
      id: 'file:///src/bar.ts',
      role: 'source_file',
      displayName: 'bar.ts',
      relations: [{ kind: 'contains', targetId: 'file:///src/bar.ts#L1' }],
    });
    expect(entity.relations).toHaveLength(1);
    expect(entity.relations[0].kind).toBe('contains');
  });

  it('accepts spatial bounds (2D)', () => {
    const entity = createEntity({
      id: 'panel://terminal',
      role: 'panel',
      displayName: 'Terminal',
      spatial: { x: 0, y: 300, width: 800, height: 200 },
    });
    expect(entity.spatial).toBeDefined();
    if (entity.spatial && !('z' in entity.spatial)) {
      expect(entity.spatial.width).toBe(800);
    }
  });

  it('accepts spatial bounds (3D)', () => {
    const entity = createEntity({
      id: 'anchor://room-1',
      role: 'spatial_anchor',
      displayName: 'Room Anchor',
      spatial: { x: 0, y: 0, z: 0, width: 1, height: 2, depth: 3 },
    });
    expect(entity.spatial).toBeDefined();
    if (entity.spatial && 'z' in entity.spatial) {
      expect(entity.spatial.depth).toBe(3);
    }
  });
});
