import type { FederationEnvelope } from '../message';

export type SignalingMessageHandler = (envelope: FederationEnvelope) => void;

export interface SignalingPeer {
  peerId: string;
  send: SignalingMessageHandler;
  connectedAt: number;
}

export class SignalingServer {
  private peers: Map<string, SignalingPeer> = new Map();
  private messageLog: FederationEnvelope[] = [];
  private maxLogSize = 1000;

  register(peerId: string, send: SignalingMessageHandler): void {
    this.peers.set(peerId, {
      peerId,
      send,
      connectedAt: Date.now(),
    });
  }

  unregister(peerId: string): void {
    this.peers.delete(peerId);
  }

  isOnline(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  send(targetPeerId: string, envelope: FederationEnvelope): boolean {
    const peer = this.peers.get(targetPeerId);
    if (!peer) return false;
    try {
      peer.send(envelope);
      this.log(envelope);
      return true;
    } catch {
      this.peers.delete(targetPeerId);
      return false;
    }
  }

  broadcast(envelope: FederationEnvelope, excludePeerId?: string): number {
    let sent = 0;
    for (const [id, peer] of this.peers) {
      if (id === excludePeerId) continue;
      try {
        peer.send(envelope);
        sent++;
      } catch {
        this.peers.delete(id);
      }
    }
    if (sent > 0) this.log(envelope);
    return sent;
  }

  getOnlinePeers(): string[] {
    return Array.from(this.peers.keys());
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  getRecentMessages(count: number = 50): FederationEnvelope[] {
    return this.messageLog.slice(-count);
  }

  clear(): void {
    this.peers.clear();
    this.messageLog = [];
  }

  private log(envelope: FederationEnvelope): void {
    this.messageLog.push(envelope);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog = this.messageLog.slice(-this.maxLogSize);
    }
  }
}
