import type { FederationEnvelope, FederationMessageType } from '../message';

export type ChannelPurpose = 'control' | 'sync' | 'intent' | 'provenance' | 'stream';

export interface ChannelSpec {
  purpose: ChannelPurpose;
  label: string;
  ordered: boolean;
  maxRetransmits?: number;
}

const CHANNEL_SPECS: Record<ChannelPurpose, ChannelSpec> = {
  control: { purpose: 'control', label: 'usir-control', ordered: true, maxRetransmits: 3 },
  sync: { purpose: 'sync', label: 'usir-sync', ordered: true, maxRetransmits: 5 },
  intent: { purpose: 'intent', label: 'usir-intent', ordered: true, maxRetransmits: 2 },
  provenance: { purpose: 'provenance', label: 'usir-provenance', ordered: true, maxRetransmits: 2 },
  stream: { purpose: 'stream', label: 'usir-stream', ordered: false, maxRetransmits: 0 },
};

const MESSAGE_TO_CHANNEL: Record<FederationMessageType, ChannelPurpose> = {
  'federation.offer': 'control',
  'federation.answer': 'control',
  'federation.ice': 'control',
  'federation.join': 'control',
  'federation.leave': 'control',
  'federation.sync': 'sync',
  'federation.intent': 'intent',
  'federation.provenance': 'provenance',
  'federation.heartbeat': 'control',
  'federation.capability': 'control',
  'federation.error': 'control',
};

export interface DataChannel {
  spec: ChannelSpec;
  send(envelope: FederationEnvelope): void;
  isOpen(): boolean;
  onMessage(handler: (envelope: FederationEnvelope) => void): void;
  close(): void;
}

export class DataChannelManager {
  private channels: Map<ChannelPurpose, DataChannel> = new Map();
  private messageHandler?: (envelope: FederationEnvelope) => void;
  private pendingBuffer: Array<{ purpose: ChannelPurpose; envelope: FederationEnvelope }> = [];
  private maxBufferSize = 500;

  registerChannel(purpose: ChannelPurpose, channel: DataChannel): void {
    this.channels.set(purpose, channel);
    channel.onMessage((envelope) => {
      this.messageHandler?.(envelope);
    });
    this.flushPending(purpose);
  }

  unregisterChannel(purpose: ChannelPurpose): void {
    const channel = this.channels.get(purpose);
    if (channel) {
      channel.close();
      this.channels.delete(purpose);
    }
  }

  send(envelope: FederationEnvelope): void {
    const purpose = MESSAGE_TO_CHANNEL[envelope.type] ?? 'control';
    const channel = this.channels.get(purpose);
    if (channel && channel.isOpen()) {
      channel.send(envelope);
    } else {
      if (this.pendingBuffer.length < this.maxBufferSize) {
        this.pendingBuffer.push({ purpose, envelope });
      }
    }
  }

  broadcast(envelopes: FederationEnvelope[]): void {
    for (const env of envelopes) this.send(env);
  }

  onMessage(handler: (envelope: FederationEnvelope) => void): void {
    this.messageHandler = handler;
  }

  isChannelOpen(purpose: ChannelPurpose): boolean {
    const ch = this.channels.get(purpose);
    return ch !== undefined && ch.isOpen();
  }

  getChannel(purpose: ChannelPurpose): DataChannel | undefined {
    return this.channels.get(purpose);
  }

  getOpenCount(): number {
    let count = 0;
    for (const ch of this.channels.values()) {
      if (ch.isOpen()) count++;
    }
    return count;
  }

  closeAll(): void {
    for (const [purpose, ch] of this.channels) {
      ch.close();
      this.channels.delete(purpose);
    }
    this.pendingBuffer = [];
  }

  private flushPending(purpose: ChannelPurpose): void {
    const remaining: Array<{ purpose: ChannelPurpose; envelope: FederationEnvelope }> = [];
    for (const item of this.pendingBuffer) {
      if (item.purpose === purpose) {
        const channel = this.channels.get(purpose);
        if (channel && channel.isOpen()) {
          channel.send(item.envelope);
          continue;
        }
      }
      remaining.push(item);
    }
    this.pendingBuffer = remaining;
  }
}

export function getChannelSpec(purpose: ChannelPurpose): ChannelSpec {
  return CHANNEL_SPECS[purpose];
}

export function resolveChannelForMessage(type: FederationMessageType): ChannelPurpose {
  return MESSAGE_TO_CHANNEL[type] ?? 'control';
}
