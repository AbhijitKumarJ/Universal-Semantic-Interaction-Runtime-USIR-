import { describe, it, expect } from 'vitest';
import { SpatialAnchorAdapter } from './spatial-anchor-adapter';

describe('SpatialAnchorAdapter', () => {
  it('creates a spatial anchor', async () => {
    const adapter = new SpatialAnchorAdapter();
    const anchor = await adapter.createAnchor(
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0, w: 1 },
      'world',
    );
    expect(anchor.anchorId).toBeTruthy();
    expect(anchor.position.x).toBe(1);
    expect(anchor.coordinateSystem).toBe('world');
    expect(anchor.persistedAt).toBeGreaterThan(0);
  });

  it('queries anchors by coordinate system', async () => {
    const adapter = new SpatialAnchorAdapter();
    await adapter.createAnchor({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 'world');
    await adapter.createAnchor({ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0, w: 1 }, 'room');
    await adapter.createAnchor({ x: 2, y: 2, z: 2 }, { x: 0, y: 0, z: 0, w: 1 }, 'room');
    const roomAnchors = await adapter.queryAnchors({ coordinateSystem: 'room' });
    expect(roomAnchors).toHaveLength(2);
    const worldAnchors = await adapter.queryAnchors({ coordinateSystem: 'world' });
    expect(worldAnchors).toHaveLength(1);
  });

  it('queries anchors by proximity', async () => {
    const adapter = new SpatialAnchorAdapter();
    await adapter.createAnchor({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 'world');
    await adapter.createAnchor({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 'world');
    await adapter.createAnchor({ x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 'world');
    const near = await adapter.queryAnchors({ near: { x: 0, y: 0, z: 0 }, radius: 10 });
    expect(near).toHaveLength(2);
  });

  it('deletes anchors', async () => {
    const adapter = new SpatialAnchorAdapter();
    const anchor = await adapter.createAnchor({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 'world');
    await adapter.deleteAnchor(anchor.anchorId);
    const remaining = await adapter.queryAnchors();
    expect(remaining).toHaveLength(0);
  });

  it('throws on deleting nonexistent anchor', async () => {
    const adapter = new SpatialAnchorAdapter();
    await expect(adapter.deleteAnchor('nonexistent')).rejects.toThrow('not found');
  });

  it('transforms points between coordinate systems', async () => {
    const adapter = new SpatialAnchorAdapter();
    const same = await adapter.transformBetween('world', 'world', { x: 1, y: 2, z: 3 });
    expect(same.x).toBe(1);
    expect(same.y).toBe(2);
    expect(same.z).toBe(3);
    const room = await adapter.transformBetween('world', 'room', { x: 1, y: 2, z: 3 });
    expect(room.x).toBe(0);
    expect(room.y).toBe(1.5);
    expect(room.z).toBe(3);
  });
});
