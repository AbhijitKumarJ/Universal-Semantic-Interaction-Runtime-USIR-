import type { SignalingServer } from '../signaling';
import { createMessage, type FederationEnvelope, type JoinPayload, type LeavePayload } from '../message';
import type { PeerConnectionState } from '../topology';

export type DiscoveryEvent =
  | { type: 'peer_joined'; peerId: string; payload: JoinPayload }
  | { type: 'peer_left'; peerId: string; payload?: LeavePayload }
  | { type: 'peer_updated'; peerId: string }
  | { type: 'scan_completed'; knownPeers: string[] };

export class DiscoveryService {
  private signaling: SignalingServer;
  private localPeerId: string;
  private observers: Array<(event: DiscoveryEvent) => void> = [];
  private knownPeers: Set<string> = new Set();
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private joinPayload: JoinPayload | null = null;

  constructor(localPeerId: string, signaling: SignalingServer) {
    this.localPeerId = localPeerId;
    this.signaling = signaling;
  }

  start(localCapabilities: JoinPayload): void {
    this.joinPayload = localCapabilities;

    this.signaling.register(this.localPeerId, (envelope) => {
      this.handleDiscoveryMessage(envelope);
    });

    const joinMsg = createMessage('federation.join', this.localPeerId, localCapabilities);
    this.signaling.broadcast(joinMsg, this.localPeerId);

    this.scanInterval = setInterval(() => {
      this.notify({ type: 'scan_completed', knownPeers: Array.from(this.knownPeers) });
    }, 30000);

    this.broadcastInterval = setInterval(() => {
      this.announcePresence();
    }, 15000);
  }

  stop(): void {
    const leaveMsg = createMessage('federation.leave', this.localPeerId, { reason: 'shutdown' } satisfies LeavePayload);
    this.signaling.broadcast(leaveMsg, this.localPeerId);
    this.signaling.unregister(this.localPeerId);

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    this.knownPeers.clear();
  }

  observe(handler: (event: DiscoveryEvent) => void): () => void {
    this.observers.push(handler);
    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  getKnownPeers(): string[] {
    return Array.from(this.knownPeers);
  }

  isPeerKnown(peerId: string): boolean {
    return this.knownPeers.has(peerId);
  }

  private handleDiscoveryMessage(envelope: FederationEnvelope): void {
    switch (envelope.type) {
      case 'federation.join': {
        const payload = envelope.payload as JoinPayload;
        this.knownPeers.add(envelope.senderId);
        this.notify({ type: 'peer_joined', peerId: envelope.senderId, payload });

        const response = createMessage('federation.join', this.localPeerId, this.joinPayload!, envelope.senderId);
        this.signaling.send(envelope.senderId, response);
        break;
      }
      case 'federation.leave': {
        this.knownPeers.delete(envelope.senderId);
        this.notify({ type: 'peer_left', peerId: envelope.senderId, payload: envelope.payload as LeavePayload });
        break;
      }
      case 'federation.capability': {
        this.notify({ type: 'peer_updated', peerId: envelope.senderId });
        break;
      }
    }
  }

  private announcePresence(): void {
    if (!this.joinPayload) return;
    const announce = createMessage('federation.join', this.localPeerId, this.joinPayload);
    this.signaling.broadcast(announce, this.localPeerId);
  }

  private notify(event: DiscoveryEvent): void {
    for (const h of this.observers) h(event);
  }
}
