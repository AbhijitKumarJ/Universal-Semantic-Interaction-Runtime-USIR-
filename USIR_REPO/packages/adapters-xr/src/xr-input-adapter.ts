import type { SpatialVec3 } from './unity-bridge-adapter';

export interface FingerJoint {
  type: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
  positions: SpatialVec3[];
}

export interface HandTracking {
  handedness: 'left' | 'right';
  wrist: SpatialVec3;
  fingers: FingerJoint[];
  gestures: string[];
  timestamp: number;
}

export interface EyeGaze {
  origin: SpatialVec3;
  direction: SpatialVec3;
  hitEntityId?: string;
  hitPoint?: SpatialVec3;
  timestamp: number;
}

export interface XrInteractionEvent {
  type: 'select' | 'grab' | 'release' | 'hover' | 'gesture';
  source: 'hand' | 'eye' | 'controller';
  targetEntityId?: string;
  position?: SpatialVec3;
  timestamp: number;
}

export interface EntityInteractionMapping {
  entityId: string;
  handler: (event: XrInteractionEvent) => void;
}

export class XrInputAdapter {
  private interactionEvents: XrInteractionEvent[] = [];
  private entityMappings: Map<string, Array<(event: XrInteractionEvent) => void>> = new Map();

  injectInteraction(event: XrInteractionEvent): void {
    this.interactionEvents.push(event);
    const handlers = this.entityMappings.get(event.targetEntityId ?? '');
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch { /* handler error */ }
      }
    }
  }

  async getHandTracking(): Promise<HandTracking[]> {
    return [
      {
        handedness: 'left',
        wrist: { x: 0.2, y: -0.1, z: 0.3 },
        fingers: [
          { type: 'thumb', positions: [{ x: 0.22, y: -0.08, z: 0.28 }, { x: 0.25, y: -0.05, z: 0.25 }] },
          { type: 'index', positions: [{ x: 0.2, y: -0.1, z: 0.3 }, { x: 0.23, y: -0.12, z: 0.27 }] },
        ],
        gestures: ['open'],
        timestamp: Date.now(),
      },
      {
        handedness: 'right',
        wrist: { x: -0.2, y: -0.1, z: 0.3 },
        fingers: [
          { type: 'thumb', positions: [{ x: -0.18, y: -0.08, z: 0.28 }, { x: -0.15, y: -0.05, z: 0.25 }] },
          { type: 'index', positions: [{ x: -0.2, y: -0.1, z: 0.3 }, { x: -0.17, y: -0.12, z: 0.27 }] },
        ],
        gestures: ['point'],
        timestamp: Date.now(),
      },
    ];
  }

  async getEyeGaze(): Promise<EyeGaze> {
    return {
      origin: { x: 0, y: 1.7, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      timestamp: Date.now(),
    };
  }

  async pollInteractions(): Promise<XrInteractionEvent[]> {
    const result = [...this.interactionEvents];
    this.interactionEvents = [];
    return result;
  }

  async mapEntityInteraction(entityId: string, handler: (event: XrInteractionEvent) => void): Promise<void> {
    if (!entityId) throw new Error('entityId is required');
    if (!this.entityMappings.has(entityId)) {
      this.entityMappings.set(entityId, []);
    }
    this.entityMappings.get(entityId)!.push(handler);
  }

  async unmapEntityInteraction(entityId: string): Promise<void> {
    if (!entityId) throw new Error('entityId is required');
    this.entityMappings.delete(entityId);
  }

  getTools() {
    return [
      {
        name: 'xr.input.handTracking',
        description: 'Get hand tracking data for both hands.',
        execute: async () => {
          const hands = await this.getHandTracking();
          return { hands };
        },
      },
      {
        name: 'xr.input.eyeGaze',
        description: 'Get eye gaze tracking data.',
        execute: async () => {
          const gaze = await this.getEyeGaze();
          return { gaze };
        },
      },
      {
        name: 'xr.input.pollInteractions',
        description: 'Poll for pending XR interaction events.',
        execute: async () => {
          const events = await this.pollInteractions();
          return { count: events.length, events };
        },
      },
      {
        name: 'xr.input.mapEntity',
        description: 'Map an entity to handle XR interactions. Args: { entityId: string }',
        execute: async (args: Record<string, unknown>) => {
          const entityId = args.entityId as string;
          if (!entityId) throw new Error('entityId is required');
          await this.mapEntityInteraction(entityId, (_event: XrInteractionEvent) => {});
          return { success: true, entityId };
        },
      },
      {
        name: 'xr.input.unmapEntity',
        description: 'Unmap an entity from XR interaction handling. Args: { entityId: string }',
        execute: async (args: Record<string, unknown>) => {
          const entityId = args.entityId as string;
          if (!entityId) throw new Error('entityId is required');
          await this.unmapEntityInteraction(entityId);
          return { success: true };
        },
      },
    ];
  }
}
