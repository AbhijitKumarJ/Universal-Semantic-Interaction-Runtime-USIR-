import type { EntityRole } from '@usir/protocol/entities';
import type { IntentLayer } from '@usir/protocol/intents';

export type PeerStatus = 'online' | 'away' | 'busy' | 'offline';
export type PeerTrustLevel = 'local' | 'known' | 'anonymous' | 'blocked';

export interface PeerCapability {
  supportedRoles: EntityRole[];
  supportedLayers: IntentLayer[];
  supportedIntents: string[];
}

export interface FederationPeer {
  peerId: string;
  displayName: string;
  runtimeVersion: string;
  capabilities: PeerCapability;
  addresses: string[];
  publicKey?: string;
  trustLevel: PeerTrustLevel;
  metadata: Record<string, unknown>;
  lastSeen: number;
  status: PeerStatus;
}

export interface PeerDirectoryEntry {
  peer: FederationPeer;
  connectedAt: number;
  roundTripMs?: number;
}

export function createPeer(partial: Partial<FederationPeer> & Pick<FederationPeer, 'peerId' | 'displayName'>): FederationPeer {
  return {
    runtimeVersion: '0.1.0',
    capabilities: {
      supportedRoles: [],
      supportedLayers: [],
      supportedIntents: [],
    },
    addresses: [],
    trustLevel: 'anonymous',
    metadata: {},
    lastSeen: Date.now(),
    status: 'online',
    ...partial,
  };
}
