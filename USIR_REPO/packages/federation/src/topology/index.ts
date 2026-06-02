export type TopologyType = 'star' | 'mesh' | 'hybrid';

export interface FederationTopology {
  type: TopologyType;
  hubId?: string;
  maxPeers: number;
}

export type PeerConnectionState =
  | 'idle'
  | 'connecting'
  | 'awaiting_answer'
  | 'connected'
  | 'syncing'
  | 'synced'
  | 'disconnecting'
  | 'disconnected'
  | 'error';

export type PeerConnectionEvent =
  | 'connect_requested'
  | 'offer_sent'
  | 'answer_received'
  | 'answer_sent'
  | 'ice_complete'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'heartbeat_timeout'
  | 'disconnect_requested'
  | 'disconnected'
  | 'error_occurred';

const TRANSITIONS: Record<PeerConnectionState, Partial<Record<PeerConnectionEvent, PeerConnectionState>>> = {
  idle: {
    connect_requested: 'connecting',
  },
  connecting: {
    offer_sent: 'awaiting_answer',
    error_occurred: 'error',
  },
  awaiting_answer: {
    answer_received: 'connected',
    error_occurred: 'error',
    heartbeat_timeout: 'disconnected',
  },
  connected: {
    sync_started: 'syncing',
    disconnect_requested: 'disconnecting',
    heartbeat_timeout: 'disconnected',
    error_occurred: 'error',
  },
  syncing: {
    sync_completed: 'synced',
    sync_failed: 'connected',
    error_occurred: 'error',
  },
  synced: {
    sync_started: 'syncing',
    disconnect_requested: 'disconnecting',
    heartbeat_timeout: 'disconnected',
    error_occurred: 'error',
  },
  disconnecting: {
    disconnected: 'disconnected',
    error_occurred: 'error',
  },
  disconnected: {
    connect_requested: 'connecting',
  },
  error: {
    connect_requested: 'connecting',
    disconnect_requested: 'disconnected',
  },
};

export function transitionState(
  current: PeerConnectionState,
  event: PeerConnectionEvent,
): PeerConnectionState {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    throw new Error(
      `Invalid transition: ${current} -> ${event}`,
    );
  }
  return next;
}

export function isConnected(state: PeerConnectionState): boolean {
  return state === 'connected' || state === 'syncing' || state === 'synced';
}
