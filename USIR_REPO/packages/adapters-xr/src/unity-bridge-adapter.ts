export interface SpatialVec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SpatialTransform {
  entityId: string;
  position: SpatialVec3;
  rotation: Quaternion;
  scale: SpatialVec3;
  timestamp: number;
}

export interface XrEvent {
  type: string;
  source: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type TransportType = 'named-pipe' | 'websocket';

export class UnityBridgeAdapter {
  private connected = false;
  private endpoint = '';
  private transport: TransportType = 'websocket';
  private transforms: SpatialTransform[] = [];
  private events: XrEvent[] = [];

  get connected_(): boolean { return this.connected; }

  async connect(endpoint: string, transport?: TransportType): Promise<void> {
    if (this.connected) throw new Error('Already connected to Unity');
    if (!endpoint) throw new Error('endpoint is required');
    this.endpoint = endpoint;
    this.transport = transport ?? 'websocket';
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Unity');
    this.connected = false;
    this.endpoint = '';
    this.transforms = [];
    this.events = [];
  }

  async sendTransform(transform: SpatialTransform): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Unity');
    this.transforms.push(transform);
  }

  async receiveTransforms(): Promise<SpatialTransform[]> {
    if (!this.connected) throw new Error('Not connected to Unity');
    const result = [...this.transforms];
    this.transforms = [];
    return result;
  }

  async triggerEvent(event: XrEvent): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Unity');
    this.events.push(event);
  }

  async pollEvents(): Promise<XrEvent[]> {
    if (!this.connected) throw new Error('Not connected to Unity');
    const result = [...this.events];
    this.events = [];
    return result;
  }

  getTools() {
    return [
      {
        name: 'xr.unity.connect',
        description: 'Connect to Unity XR runtime. Args: { endpoint: string, transport?: "named-pipe"|"websocket" }',
        execute: async (args: Record<string, unknown>) => {
          const endpoint = args.endpoint as string;
          const transport = args.transport as TransportType | undefined;
          await this.connect(endpoint, transport);
          return { success: true, endpoint, transport: this.transport };
        },
      },
      {
        name: 'xr.unity.disconnect',
        description: 'Disconnect from Unity XR runtime.',
        execute: async () => {
          await this.disconnect();
          return { success: true };
        },
      },
      {
        name: 'xr.unity.sendTransform',
        description: 'Send a spatial transform to Unity. Args: { entityId: string, position: {x,y,z}, rotation: {x,y,z,w}, scale: {x,y,z} }',
        execute: async (args: Record<string, unknown>) => {
          const entityId = args.entityId as string;
          const position = args.position as SpatialVec3;
          const rotation = args.rotation as Quaternion;
          const scale = args.scale as SpatialVec3;
          if (!entityId || !position || !rotation || !scale) {
            throw new Error('entityId, position, rotation, and scale are required');
          }
          const transform: SpatialTransform = { entityId, position, rotation, scale, timestamp: Date.now() };
          await this.sendTransform(transform);
          return { success: true, entityId };
        },
      },
      {
        name: 'xr.unity.receiveTransforms',
        description: 'Receive pending spatial transforms from Unity.',
        execute: async () => {
          const transforms = await this.receiveTransforms();
          return { count: transforms.length, transforms };
        },
      },
      {
        name: 'xr.unity.triggerEvent',
        description: 'Trigger an XR event in Unity. Args: { type: string, source: string, data: object }',
        execute: async (args: Record<string, unknown>) => {
          const type = args.type as string;
          const source = args.source as string;
          const data = args.data as Record<string, unknown>;
          if (!type || !source) throw new Error('type and source are required');
          const event: XrEvent = { type, source, data: data ?? {}, timestamp: Date.now() };
          await this.triggerEvent(event);
          return { success: true, type, source };
        },
      },
      {
        name: 'xr.unity.pollEvents',
        description: 'Poll for pending XR events from Unity.',
        execute: async () => {
          const events = await this.pollEvents();
          return { count: events.length, events };
        },
      },
    ];
  }
}
