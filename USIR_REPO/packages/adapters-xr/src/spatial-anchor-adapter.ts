import type { SpatialVec3, Quaternion } from './unity-bridge-adapter';

export interface SpatialAnchor {
  anchorId: string;
  position: SpatialVec3;
  rotation: Quaternion;
  coordinateSystem: string;
  persistedAt: number;
  metadata: Record<string, unknown>;
}

export class SpatialAnchorAdapter {
  private anchors = new Map<string, SpatialAnchor>();
  private nextId = 1;

  async createAnchor(
    position: SpatialVec3,
    rotation: Quaternion,
    coordinateSystem: string,
    metadata?: Record<string, unknown>,
  ): Promise<SpatialAnchor> {
    if (!position || !rotation || !coordinateSystem) {
      throw new Error('position, rotation, and coordinateSystem are required');
    }
    const anchorId = `anchor-${this.nextId++}`;
    const anchor: SpatialAnchor = {
      anchorId,
      position,
      rotation,
      coordinateSystem,
      persistedAt: Date.now(),
      metadata: metadata ?? {},
    };
    this.anchors.set(anchorId, anchor);
    return { ...anchor };
  }

  async queryAnchors(options?: { coordinateSystem?: string; near?: SpatialVec3; radius?: number }): Promise<SpatialAnchor[]> {
    let results = Array.from(this.anchors.values());

    if (options?.coordinateSystem) {
      results = results.filter((a) => a.coordinateSystem === options.coordinateSystem);
    }

    if (options?.near && options?.radius) {
      results = results.filter((a) => {
        const dx = a.position.x - options.near!.x;
        const dy = a.position.y - options.near!.y;
        const dz = a.position.z - options.near!.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return dist <= options.radius!;
      });
    }

    return results.map((a) => ({ ...a }));
  }

  async deleteAnchor(anchorId: string): Promise<void> {
    if (!this.anchors.has(anchorId)) throw new Error(`Anchor not found: ${anchorId}`);
    this.anchors.delete(anchorId);
  }

  async transformBetween(
    fromCoord: string,
    toCoord: string,
    point: SpatialVec3,
  ): Promise<SpatialVec3> {
    if (!fromCoord || !toCoord || !point) throw new Error('fromCoord, toCoord, and point are required');
    // Simple identity transform for same-coordinate requests
    if (fromCoord === toCoord) return { ...point };
    // Offset-based transform for demo purposes
    const offset = this.getCoordinateOffset(fromCoord, toCoord);
    return {
      x: point.x + offset.x,
      y: point.y + offset.y,
      z: point.z + offset.z,
    };
  }

  getTools() {
    return [
      {
        name: 'xr.anchor.create',
        description: 'Create a spatial anchor. Args: { position: {x,y,z}, rotation: {x,y,z,w}, coordinateSystem: string, metadata?: object }',
        execute: async (args: Record<string, unknown>) => {
          const position = args.position as SpatialVec3;
          const rotation = args.rotation as Quaternion;
          const coordinateSystem = args.coordinateSystem as string;
          const metadata = args.metadata as Record<string, unknown> | undefined;
          const anchor = await this.createAnchor(position, rotation, coordinateSystem, metadata);
          return { anchor };
        },
      },
      {
        name: 'xr.anchor.query',
        description: 'Query spatial anchors. Args: { coordinateSystem?: string, near?: {x,y,z}, radius?: number }',
        execute: async (args: Record<string, unknown>) => {
          const anchors = await this.queryAnchors({
            coordinateSystem: args.coordinateSystem as string | undefined,
            near: args.near as SpatialVec3 | undefined,
            radius: args.radius as number | undefined,
          });
          return { count: anchors.length, anchors };
        },
      },
      {
        name: 'xr.anchor.delete',
        description: 'Delete a spatial anchor. Args: { anchorId: string }',
        execute: async (args: Record<string, unknown>) => {
          const anchorId = args.anchorId as string;
          if (!anchorId) throw new Error('anchorId is required');
          await this.deleteAnchor(anchorId);
          return { success: true };
        },
      },
      {
        name: 'xr.anchor.transform',
        description: 'Transform a point between coordinate systems. Args: { fromCoord: string, toCoord: string, point: {x,y,z} }',
        execute: async (args: Record<string, unknown>) => {
          const fromCoord = args.fromCoord as string;
          const toCoord = args.toCoord as string;
          const point = args.point as SpatialVec3;
          const result = await this.transformBetween(fromCoord, toCoord, point);
          return { fromCoord, toCoord, result };
        },
      },
    ];
  }

  private coordinateOffsets = new Map<string, SpatialVec3>([
    ['world', { x: 0, y: 0, z: 0 }],
    ['room', { x: 1, y: 0.5, z: 0 }],
    ['tracking', { x: -0.5, y: 0, z: 0.5 }],
  ]);

  private getCoordinateOffset(from: string, to: string): SpatialVec3 {
    const fromOffset = this.coordinateOffsets.get(from) ?? { x: 0, y: 0, z: 0 };
    const toOffset = this.coordinateOffsets.get(to) ?? { x: 0, y: 0, z: 0 };
    return {
      x: fromOffset.x - toOffset.x,
      y: fromOffset.y - toOffset.y,
      z: fromOffset.z - toOffset.z,
    };
  }
}
