import type { SignalingServer } from '../signaling';
import { createMessage, type FederationEnvelope, type CapabilityPayload } from '../message';

export interface LocalCapability {
  supportedRoles: string[];
  supportedLayers: number[];
  supportedIntents: string[];
}

export interface RemoteCapability {
  peerId: string;
  capability: CapabilityPayload;
  receivedAt: number;
}

export class CapabilityAdvertisement {
  private localCapability: LocalCapability = {
    supportedRoles: [],
    supportedLayers: [],
    supportedIntents: [],
  };
  private remoteCapabilities: Map<string, RemoteCapability> = new Map();
  private signaling: SignalingServer;
  private localPeerId: string;
  private observers: Array<(peerId: string, caps: CapabilityPayload) => void> = [];

  constructor(localPeerId: string, signaling: SignalingServer) {
    this.localPeerId = localPeerId;
    this.signaling = signaling;
  }

  setLocalCapability(cap: Partial<LocalCapability>): void {
    Object.assign(this.localCapability, cap);
  }

  addSupportedRole(role: string): void {
    if (!this.localCapability.supportedRoles.includes(role)) {
      this.localCapability.supportedRoles.push(role);
    }
  }

  addSupportedLayer(layer: number): void {
    if (!this.localCapability.supportedLayers.includes(layer)) {
      this.localCapability.supportedLayers.push(layer);
    }
  }

  addSupportedIntent(intent: string): void {
    if (!this.localCapability.supportedIntents.includes(intent)) {
      this.localCapability.supportedIntents.push(intent);
    }
  }

  getLocalCapability(): LocalCapability {
    return { ...this.localCapability };
  }

  broadcast(): void {
    if (this.localCapability.supportedRoles.length === 0) return;

    const payload: CapabilityPayload = {
      supportedRoles: this.localCapability.supportedRoles,
      supportedLayers: this.localCapability.supportedLayers,
      supportedIntents: this.localCapability.supportedIntents,
    };

    const envelope = createMessage('federation.capability', this.localPeerId, payload);
    this.signaling.broadcast(envelope, this.localPeerId);
  }

  handleCapabilityMessage(envelope: FederationEnvelope): void {
    const payload = envelope.payload as CapabilityPayload;
    const peerId = envelope.senderId;

    this.remoteCapabilities.set(peerId, {
      peerId,
      capability: payload,
      receivedAt: Date.now(),
    });

    for (const h of this.observers) h(peerId, payload);
  }

  getRemoteCapability(peerId: string): CapabilityPayload | undefined {
    return this.remoteCapabilities.get(peerId)?.capability;
  }

  getAllRemoteCapabilities(): RemoteCapability[] {
    return Array.from(this.remoteCapabilities.values());
  }

  removePeer(peerId: string): void {
    this.remoteCapabilities.delete(peerId);
  }

  onRemoteCapability(handler: (peerId: string, caps: CapabilityPayload) => void): () => void {
    this.observers.push(handler);
    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  clear(): void {
    this.remoteCapabilities.clear();
  }
}
