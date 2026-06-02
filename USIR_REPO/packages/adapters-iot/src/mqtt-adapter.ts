export interface MqttMessage {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

export interface MqttConnectionOptions {
  clientId?: string;
  username?: string;
  password?: string;
  keepalive?: number;
  clean?: boolean;
}

export interface TopicBridge {
  topic: string;
  entityId: string;
  direction: 'to-entity' | 'from-entity' | 'bidirectional';
}

export class MqttAdapter {
  private connected = false;
  private brokerUrl = '';
  private subscriptions = new Map<string, Array<(msg: MqttMessage) => void>>();
  private messages: MqttMessage[] = [];
  private bridges: TopicBridge[] = [];
  private active = false;

  get connected_(): boolean { return this.connected; }

  async connect(brokerUrl: string, _options?: MqttConnectionOptions): Promise<void> {
    if (this.connected) throw new Error('Already connected to MQTT broker');
    this.brokerUrl = brokerUrl;
    this.connected = true;
    this.active = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) throw new Error('Not connected to MQTT broker');
    this.connected = false;
    this.active = false;
    this.subscriptions.clear();
  }

  async publish(topic: string, payload: string, options?: { qos?: 0 | 1 | 2; retain?: boolean }): Promise<void> {
    if (!this.connected) throw new Error('Not connected to MQTT broker');
    const msg: MqttMessage = {
      topic,
      payload,
      qos: options?.qos ?? 0,
      retain: options?.retain ?? false,
      timestamp: Date.now(),
    };
    this.messages.push(msg);

    for (const [subTopic, cbs] of this.subscriptions.entries()) {
      if (this.matchesTopic(subTopic, topic)) {
        for (const cb of cbs) {
          try { cb(msg); } catch { /* callback error */ }
        }
      }
    }

    for (const bridge of this.bridges) {
      if (bridge.direction === 'to-entity' || bridge.direction === 'bidirectional') {
        if (this.matchesTopic(topic, bridge.topic)) {
          this.emitEntityUpdate(bridge.entityId, payload);
        }
      }
    }
  }

  async subscribe(topic: string, callback?: (msg: MqttMessage) => void): Promise<void> {
    if (!this.connected) throw new Error('Not connected to MQTT broker');
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    if (callback) {
      this.subscriptions.get(topic)!.push(callback);
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.connected) throw new Error('Not connected to MQTT broker');
    this.subscriptions.delete(topic);
  }

  listMessages(topic?: string): MqttMessage[] {
    if (!topic) return [...this.messages];
    return this.messages.filter((m) => this.matchesTopic(m.topic, topic));
  }

  addBridge(bridge: TopicBridge): void {
    this.bridges.push(bridge);
  }

  removeBridge(topic: string, entityId: string): void {
    this.bridges = this.bridges.filter(
      (b) => !(b.topic === topic && b.entityId === entityId),
    );
  }

  listBridges(): TopicBridge[] {
    return [...this.bridges];
  }

  getTools() {
    return [
      {
        name: 'iot.mqtt.connect',
        description: 'Connect to an MQTT broker. Args: { brokerUrl: string, options?: MqttConnectionOptions }',
        execute: async (args: Record<string, unknown>) => {
          const brokerUrl = args.brokerUrl as string;
          if (!brokerUrl) throw new Error('brokerUrl is required');
          await this.connect(brokerUrl, args.options as MqttConnectionOptions | undefined);
          return { success: true, brokerUrl };
        },
      },
      {
        name: 'iot.mqtt.disconnect',
        description: 'Disconnect from the MQTT broker.',
        execute: async () => {
          await this.disconnect();
          return { success: true };
        },
      },
      {
        name: 'iot.mqtt.publish',
        description: 'Publish a message to an MQTT topic. Args: { topic: string, payload: string, qos?: 0|1|2, retain?: boolean }',
        execute: async (args: Record<string, unknown>) => {
          const topic = args.topic as string;
          if (!topic) throw new Error('topic is required');
          const payload = args.payload as string;
          if (payload === undefined) throw new Error('payload is required');
          await this.publish(topic, payload, { qos: args.qos as 0|1|2|undefined, retain: args.retain as boolean | undefined });
          return { success: true, topic };
        },
      },
      {
        name: 'iot.mqtt.subscribe',
        description: 'Subscribe to an MQTT topic. Args: { topic: string }',
        execute: async (args: Record<string, unknown>) => {
          const topic = args.topic as string;
          if (!topic) throw new Error('topic is required');
          await this.subscribe(topic);
          return { success: true, topic };
        },
      },
      {
        name: 'iot.mqtt.unsubscribe',
        description: 'Unsubscribe from an MQTT topic. Args: { topic: string }',
        execute: async (args: Record<string, unknown>) => {
          const topic = args.topic as string;
          if (!topic) throw new Error('topic is required');
          await this.unsubscribe(topic);
          return { success: true, topic };
        },
      },
      {
        name: 'iot.mqtt.listMessages',
        description: 'List received MQTT messages, optionally filtered by topic. Args: { topic?: string }',
        execute: async (args: Record<string, unknown>) => {
          const topic = args.topic as string | undefined;
          return { messages: this.listMessages(topic) };
        },
      },
      {
        name: 'iot.mqtt.bridgeTopic',
        description: 'Bridge an MQTT topic to a SemanticGraph entity. Args: { topic: string, entityId: string, direction: "to-entity"|"from-entity"|"bidirectional" }',
        execute: async (args: Record<string, unknown>) => {
          const topic = args.topic as string;
          const entityId = args.entityId as string;
          const direction = args.direction as TopicBridge['direction'];
          if (!topic || !entityId || !direction) throw new Error('topic, entityId, and direction are required');
          this.addBridge({ topic, entityId, direction });
          return { success: true, topic, entityId, direction };
        },
      },
    ];
  }

  private matchesTopic(subscribedTopic: string, publishedTopic: string): boolean {
    if (subscribedTopic === publishedTopic) return true;
    const subParts = subscribedTopic.split('/');
    const pubParts = publishedTopic.split('/');
    if (subParts.length !== pubParts.length) return false;
    return subParts.every((part, i) => part === '+' || part === '#' || part === pubParts[i]);
  }

  private emitEntityUpdate(_entityId: string, _payload: string): void {
    // In production, this pushes payload updates to the SemanticGraph entity
  }
}
