import type { ProvenanceNode, ProvenanceGraph } from '@usir/protocol/provenance';
import { createProvenanceGraph, recordProvenance } from '@usir/protocol/provenance';
import type { DataChannelManager } from '../connection/data-channel';
import type { PeerDirectory } from '../discovery/peer-directory';
import { createMessage, type ProvenancePayload } from '../message';
import { createAnchor, createProvenanceBridgeState, type ProvenanceAnchor, type ProvenanceBridgeState } from '../provenance';

const PROVENANCE_SYNC_INTERVAL = 10000;

export class ProvenanceBridge {
  readonly runtimeId: string;

  private state: ProvenanceBridgeState;
  private localGraph: ProvenanceGraph;
  private dcManager: DataChannelManager;
  private peerDirectory: PeerDirectory;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private observers: Array<(event: ProvenanceBridgeEvent) => void> = [];

  constructor(deps: {
    runtimeId: string;
    dcManager: DataChannelManager;
    peerDirectory: PeerDirectory;
  }) {
    this.runtimeId = deps.runtimeId;
    this.dcManager = deps.dcManager;
    this.peerDirectory = deps.peerDirectory;
    this.localGraph = createProvenanceGraph();
    this.state = createProvenanceBridgeState(deps.runtimeId);
  }

  start(): void {
    this.syncInterval = setInterval(() => {
      this.syncPendingProvenance();
    }, PROVENANCE_SYNC_INTERVAL);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  recordLocal(node: ProvenanceNode): void {
    const enriched: ProvenanceNode = {
      ...node,
      runtimeId: this.runtimeId,
    };
    recordProvenance(this.localGraph, enriched);
    this.state.pendingExports.push(node.provenanceId);
    this.notify({ type: 'local_recorded', provenanceId: node.provenanceId });
  }

  handleRemoteProvenance(envelope: { senderId: string; payload: ProvenancePayload }): void {
    const { senderId, payload } = envelope;

    for (const remoteNode of payload.nodes) {
      const localNode: ProvenanceNode = {
        provenanceId: `remote:${remoteNode.provenanceId}`,
        intentId: remoteNode.intentId,
        intentSnapshot: { type: remoteNode.intentType, intentId: remoteNode.intentId, timestamp: remoteNode.timestamp, actor: { type: 'system', id: remoteNode.actorId }, confidence: 1 },
        actor: { type: 'agent', id: remoteNode.actorId, parentDelegateIntentId: '', confidence: 1 },
        rationale: { type: 'inferred', rule: 'cross-runtime sync', confidence: 1 },
        authorization: { type: 'delegated', delegateIntentId: '' },
        causalParents: remoteNode.causalParents.map((p: string) => `remote:${p}`),
        timestamp: remoteNode.timestamp,
        contentHashBefore: remoteNode.contentHashBefore,
        contentHashAfter: remoteNode.contentHashAfter,
        semanticDiff: { entityId: remoteNode.entityId, entityBefore: {}, entityAfter: {}, changedFields: [] },
        runtimeId: senderId,
        remoteProvenanceId: remoteNode.provenanceId,
        remoteRuntimeId: senderId,
      };

      recordProvenance(this.localGraph, localNode);

      const anchor = createAnchor({
        anchorType: 'import',
        localRuntimeId: this.runtimeId,
        localProvenanceId: localNode.provenanceId,
        remoteRuntimeId: senderId,
        remoteProvenanceId: remoteNode.provenanceId,
      });
      this.state.anchors.set(anchor.anchorId, anchor);

      this.notify({ type: 'remote_recorded', provenanceId: localNode.provenanceId, remotePeerId: senderId });
    }
  }

  getLocalGraph(): ProvenanceGraph {
    return this.localGraph;
  }

  getAnchors(): ProvenanceAnchor[] {
    return Array.from(this.state.anchors.values());
  }

  getAnchorsForRemotePeer(remoteRuntimeId: string): ProvenanceAnchor[] {
    return Array.from(this.state.anchors.values()).filter((a) => a.remoteRuntimeId === remoteRuntimeId);
  }

  getAnchorsForEntity(entityId: string): ProvenanceAnchor[] {
    return Array.from(this.state.anchors.values()).filter((a) => {
      const node = this.localGraph.nodes.get(a.localProvenanceId);
      return node?.semanticDiff.entityId === entityId;
    });
  }

  getState(): ProvenanceBridgeState {
    return this.state;
  }

  observe(handler: (event: ProvenanceBridgeEvent) => void): () => void {
    this.observers.push(handler);
    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  private syncPendingProvenance(): void {
    const pendingIds = this.state.pendingExports;
    if (pendingIds.length === 0) return;

    const nodes = pendingIds
      .map((id) => this.localGraph.nodes.get(id))
      .filter((n): n is ProvenanceNode => n !== undefined);

    if (nodes.length === 0) return;

    const payload: ProvenancePayload = {
      runtimeId: this.runtimeId,
      nodes: nodes.map((n) => ({
        provenanceId: n.provenanceId,
        intentId: n.intentId,
        entityId: n.semanticDiff.entityId,
        intentType: n.intentSnapshot.type,
        actorId: n.actor.type === 'agent' ? n.actor.id : `${n.actor.type}:${n.actor.id}`,
        timestamp: n.timestamp,
        contentHashBefore: n.contentHashBefore,
        contentHashAfter: n.contentHashAfter,
        causalParents: n.causalParents,
      })),
    };

    const onlinePeers = this.peerDirectory.list({ status: 'online' });
    for (const peer of onlinePeers) {
      if (peer.peerId === this.runtimeId) continue;
      const envelope = createMessage('federation.provenance', this.runtimeId, payload, peer.peerId);
      this.dcManager.send(envelope);
    }

    this.state.pendingExports = [];
    this.state.lastSyncAt = Date.now();
    this.notify({ type: 'sync_completed', nodeCount: nodes.length });
  }

  private notify(event: ProvenanceBridgeEvent): void {
    for (const h of this.observers) h(event);
  }
}

export type ProvenanceBridgeEvent =
  | { type: 'local_recorded'; provenanceId: string }
  | { type: 'remote_recorded'; provenanceId: string; remotePeerId: string }
  | { type: 'sync_completed'; nodeCount: number };
