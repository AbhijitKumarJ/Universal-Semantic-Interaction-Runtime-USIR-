import type { FederationEnvelope } from '../message';
import type { PeerConnectionState } from '../topology';

export type TransportEventType =
  | 'message'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'state_change'
  | 'error';

export interface TransportEventHandler {
  (event: 'message', handler: (envelope: FederationEnvelope) => void): void;
  (event: 'peer_connected', handler: (peerId: string) => void): void;
  (event: 'peer_disconnected', handler: (peerId: string) => void): void;
  (event: 'state_change', handler: (state: PeerConnectionState) => void): void;
  (event: 'error', handler: (error: Error) => void): void;
}

export interface TransportConfig {
  peerId: string;
  signalingUrl: string;
  stunServers?: string[];
  turnServers?: Array<{ url: string; username?: string; credential?: string }>;
}

export interface FederationTransport {
  readonly peerId: string;
  getState(): PeerConnectionState;
  connect(config: TransportConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(targetPeerId: string, envelope: FederationEnvelope): Promise<void>;
  broadcast(envelope: FederationEnvelope): Promise<void>;
  on: TransportEventHandler;
  off: TransportEventHandler;
}
