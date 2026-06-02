export type ProvenanceAnchorType = 'import' | 'export' | 'mirror';

export interface ProvenanceAnchor {
  anchorId: string;
  anchorType: ProvenanceAnchorType;
  localRuntimeId: string;
  localProvenanceId: string;
  remoteRuntimeId: string;
  remoteProvenanceId: string;
  linkedAt: number;
  trustChain: string[];
  signature?: string;
}

export interface CrossRuntimeCausalLink {
  localNodeId: string;
  remoteRuntimeId: string;
  remoteNodeId: string;
  direction: 'outgoing' | 'incoming';
}

export interface ProvenanceBridgeState {
  runtimeId: string;
  anchors: Map<string, ProvenanceAnchor>;
  pendingExports: string[];
  pendingImports: string[];
  lastSyncAt: number;
}

export function createProvenanceBridgeState(runtimeId: string): ProvenanceBridgeState {
  return {
    runtimeId,
    anchors: new Map(),
    pendingExports: [],
    pendingImports: [],
    lastSyncAt: 0,
  };
}

export function createAnchor(params: {
  anchorType: ProvenanceAnchorType;
  localRuntimeId: string;
  localProvenanceId: string;
  remoteRuntimeId: string;
  remoteProvenanceId: string;
}): ProvenanceAnchor {
  return {
    anchorId: `anchor_${params.localRuntimeId}_${params.localProvenanceId}_${params.remoteRuntimeId}`,
    anchorType: params.anchorType,
    localRuntimeId: params.localRuntimeId,
    localProvenanceId: params.localProvenanceId,
    remoteRuntimeId: params.remoteRuntimeId,
    remoteProvenanceId: params.remoteProvenanceId,
    linkedAt: Date.now(),
    trustChain: [],
  };
}
