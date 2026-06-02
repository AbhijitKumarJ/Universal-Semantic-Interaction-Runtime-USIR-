import type { FederationPeer, PeerStatus, PeerTrustLevel, PeerDirectoryEntry } from '../peer';
import type { CapabilityPayload } from '../message';

export interface PeerDirectoryFilter {
  status?: PeerStatus;
  trustLevel?: PeerTrustLevel;
  supportsRole?: string;
  supportsIntent?: string;
  supportsLayer?: number;
  connectedOnly?: boolean;
}

export class PeerDirectory {
  private entries: Map<string, PeerDirectoryEntry> = new Map();
  private capabilities: Map<string, CapabilityPayload> = new Map();

  register(peer: FederationPeer): void {
    const existing = this.entries.get(peer.peerId);
    this.entries.set(peer.peerId, {
      peer,
      connectedAt: existing?.connectedAt ?? Date.now(),
      roundTripMs: existing?.roundTripMs,
    });
  }

  updateStatus(peerId: string, status: PeerStatus): void {
    const entry = this.entries.get(peerId);
    if (entry) {
      entry.peer.status = status;
      entry.peer.lastSeen = Date.now();
    }
  }

  updateCapabilities(peerId: string, caps: CapabilityPayload): void {
    this.capabilities.set(peerId, caps);
  }

  remove(peerId: string): void {
    this.entries.delete(peerId);
    this.capabilities.delete(peerId);
  }

  updateLatency(peerId: string, rttMs: number): void {
    const entry = this.entries.get(peerId);
    if (entry) {
      entry.roundTripMs = rttMs;
    }
  }

  getPeer(peerId: string): FederationPeer | undefined {
    return this.entries.get(peerId)?.peer;
  }

  getEntry(peerId: string): PeerDirectoryEntry | undefined {
    return this.entries.get(peerId);
  }

  getCapabilities(peerId: string): CapabilityPayload | undefined {
    return this.capabilities.get(peerId);
  }

  list(filter?: PeerDirectoryFilter): FederationPeer[] {
    let result = Array.from(this.entries.values()).map((e) => e.peer);

    if (filter) {
      if (filter.status) {
        result = result.filter((p) => p.status === filter.status);
      }
      if (filter.trustLevel) {
        result = result.filter((p) => p.trustLevel === filter.trustLevel);
      }
      if (filter.supportsRole) {
        result = result.filter((p) => {
          const caps = this.capabilities.get(p.peerId);
          return caps?.supportedRoles.includes(filter.supportsRole!);
        });
      }
      if (filter.supportsIntent) {
        result = result.filter((p) => {
          const caps = this.capabilities.get(p.peerId);
          return caps?.supportedIntents.includes(filter.supportsIntent!);
        });
      }
      if (filter.supportsLayer !== undefined) {
        result = result.filter((p) => {
          const caps = this.capabilities.get(p.peerId);
          return caps?.supportedLayers.includes(filter.supportsLayer!);
        });
      }
    }

    return result;
  }

  getOnlineCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.peer.status === 'online') count++;
    }
    return count;
  }

  getTotalCount(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.capabilities.clear();
  }
}
