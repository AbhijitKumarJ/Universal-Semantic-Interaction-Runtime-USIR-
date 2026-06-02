import type { CognitiveReference } from '@usir/protocol/memory';
import type { PeerDirectory } from '../discovery/peer-directory';

export interface RemoteConversationTurn {
  turnId: string;
  peerId: string;
  timestamp: number;
  rawInput: string;
  resolvedIntentId?: string;
  touchedEntityIds: string[];
}

export interface MultiPeerMemorySnapshot {
  localUserId: string;
  recentRemoteTurns: RemoteConversationTurn[];
  knownPeers: string[];
}

export class MultiPeerMemory {
  private remoteTurns: RemoteConversationTurn[] = [];
  private peerDirectory: PeerDirectory;
  private localPeerId: string;
  private maxHistory = 200;

  constructor(localPeerId: string, peerDirectory: PeerDirectory) {
    this.localPeerId = localPeerId;
    this.peerDirectory = peerDirectory;
  }

  recordRemoteTurn(turn: RemoteConversationTurn): void {
    this.remoteTurns.push(turn);
    if (this.remoteTurns.length > this.maxHistory) {
      this.remoteTurns = this.remoteTurns.slice(-this.maxHistory);
    }
  }

  getTurnsByPeer(peerId: string): RemoteConversationTurn[] {
    return this.remoteTurns.filter((t) => t.peerId === peerId);
  }

  getTouchingEntity(entityId: string): RemoteConversationTurn[] {
    return this.remoteTurns.filter((t) => t.touchedEntityIds.includes(entityId));
  }

  resolveRemoteReference(reference: CognitiveReference): RemoteConversationTurn | undefined {
    switch (reference.kind) {
      case 'conversational': {
        if (reference.position === 'most_recent' || reference.stepsBack === 0) {
          return this.remoteTurns[this.remoteTurns.length - 1];
        }
        if (reference.position === 'previous' || (reference.stepsBack && reference.stepsBack > 0)) {
          const stepsBack = reference.stepsBack ?? 1;
          return this.remoteTurns[this.remoteTurns.length - 1 - stepsBack];
        }
        if (reference.position === 'first') {
          return this.remoteTurns[0];
        }
        if (reference.position === 'last') {
          return this.remoteTurns[this.remoteTurns.length - 1];
        }
        return undefined;
      }
      case 'temporal': {
        return this.remoteTurns[this.remoteTurns.length - 1];
      }
      case 'semantic': {
        const desc = reference.description.toLowerCase();
        return this.remoteTurns
          .slice()
          .reverse()
          .find(
            (t) =>
              t.rawInput.toLowerCase().includes(desc) ||
              t.touchedEntityIds.some((id) => id.toLowerCase().includes(desc)),
          );
      }
      default:
        return undefined;
    }
  }

  snapshot(): MultiPeerMemorySnapshot {
    return {
      localUserId: this.localPeerId,
      recentRemoteTurns: this.remoteTurns.slice(-50),
      knownPeers: this.peerDirectory.list().map((p) => p.peerId),
    };
  }

  clear(): void {
    this.remoteTurns = [];
  }
}
