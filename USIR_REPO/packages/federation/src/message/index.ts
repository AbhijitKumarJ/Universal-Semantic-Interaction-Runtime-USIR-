export type FederationMessageType =
  | 'federation.offer'
  | 'federation.answer'
  | 'federation.ice'
  | 'federation.join'
  | 'federation.leave'
  | 'federation.sync'
  | 'federation.intent'
  | 'federation.provenance'
  | 'federation.heartbeat'
  | 'federation.capability'
  | 'federation.error';

export interface FederationEnvelope {
  messageId: string;
  type: FederationMessageType;
  senderId: string;
  targetId?: string;
  timestamp: number;
  payload: unknown;
}

export interface OfferPayload {
  sdp: string;
  sessionId: string;
}

export interface AnswerPayload {
  sdp: string;
  sessionId: string;
}

export interface IcePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface JoinPayload {
  peer: {
    peerId: string;
    displayName: string;
    runtimeVersion: string;
    publicKey?: string;
  };
  capabilities: {
    supportedRoles: string[];
    supportedLayers: number[];
    supportedIntents: string[];
  };
}

export interface LeavePayload {
  reason?: string;
}

export interface SyncPayload {
  baseVersion: number;
  targetVersion: number;
  patches: SyncPatch[];
}

export type SyncPatch =
  | { op: 'addEntity'; entityId: string; serializedEntity: string }
  | { op: 'removeEntity'; entityId: string }
  | { op: 'updateEntity'; entityId: string; changedFields: Array<{ field: string; value: unknown }> }
  | { op: 'addEdge'; sourceId: string; targetId: string; kind: string }
  | { op: 'removeEdge'; sourceId: string; targetId: string }
  | { op: 'updateVersion'; version: number }
  | { op: 'fullSnapshot'; serializedGraph: string };

export interface IntentPayload {
  intentType: string;
  serializedEnvelope: string;
  originRuntimeId: string;
  ttl?: number;
}

export interface ProvenancePayload {
  runtimeId: string;
  nodes: Array<{
    provenanceId: string;
    intentId: string;
    entityId: string;
    intentType: string;
    actorId: string;
    timestamp: number;
    contentHashBefore: string;
    contentHashAfter: string;
    causalParents: string[];
  }>;
}

export interface HeartbeatPayload {
  sessionId: string;
  seq: number;
}

export interface CapabilityPayload {
  supportedRoles: string[];
  supportedLayers: number[];
  supportedIntents: string[];
}

export interface ErrorPayload {
  code: string;
  message: string;
  originalMessageId?: string;
}

export type TypedFederationMessage<T extends FederationMessageType, P> = Omit<FederationEnvelope, 'type' | 'payload'> & {
  type: T;
  payload: P;
};

export function createMessage<T extends FederationMessageType, P>(
  type: T,
  senderId: string,
  payload: P,
  targetId?: string,
): TypedFederationMessage<T, P> {
  return {
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    senderId,
    targetId,
    timestamp: Date.now(),
    payload,
  };
}

export function isFederationMessage(obj: unknown): obj is FederationEnvelope {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'messageId' in obj &&
    'type' in obj &&
    'senderId' in obj &&
    'timestamp' in obj &&
    'payload' in obj
  );
}
