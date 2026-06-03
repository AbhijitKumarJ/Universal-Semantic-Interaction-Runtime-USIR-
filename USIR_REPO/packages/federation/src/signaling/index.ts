import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FederationEnvelope } from '../message';

export type SignalingMessageHandler = (envelope: FederationEnvelope) => void;

export interface SignalingPeer {
  peerId: string;
  send: SignalingMessageHandler;
  connectedAt: number;
}

export interface SignalingServerData {
  messageLog: FederationEnvelope[];
}

function saveJSON(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function loadJSON<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
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

  toJSON(): SignalingServerData {
    return { messageLog: [...this.messageLog] };
  }

  fromJSON(data: SignalingServerData): void {
    this.messageLog = data.messageLog ?? [];
  }

  save(path: string): void {
    saveJSON(path, this.toJSON());
  }

  load(path: string): boolean {
    const data = loadJSON<SignalingServerData>(path);
    if (!data) return false;
    this.fromJSON(data);
    return true;
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
