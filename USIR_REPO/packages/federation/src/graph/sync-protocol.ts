import * as Y from 'yjs';
import type { FederatedGraph } from './federated-graph';
import type { DataChannelManager } from '../connection/data-channel';
import { createMessage, type FederationEnvelope } from '../message';
import { computeDiff } from '../snapshot';
import { createSemanticGraph } from '@usir/protocol/graph';

export type SyncPhase = 'idle' | 'awaiting_state_vector' | 'syncing' | 'synced';

export interface SyncSession {
  peerId: string;
  phase: SyncPhase;
  remoteStateVector: Uint8Array | null;
  lastSyncAt: number;
}

export class SyncProtocol {
  private sessions: Map<string, SyncSession> = new Map();
  private graph: FederatedGraph;
  private dcManager: DataChannelManager;
  private localPeerId: string;

  constructor(graph: FederatedGraph, dcManager: DataChannelManager, localPeerId: string) {
    this.graph = graph;
    this.dcManager = dcManager;
    this.localPeerId = localPeerId;

    this.graph.observe((event) => {
      if (event.type === 'remote_update') return;
      this.broadcastLocalChanges();
    });
  }

  getSession(peerId: string): SyncSession | undefined {
    return this.sessions.get(peerId);
  }

  initiateSync(peerId: string): void {
    const stateVector = this.graph.getStateVector();
    const session: SyncSession = {
      peerId,
      phase: 'awaiting_state_vector',
      remoteStateVector: null,
      lastSyncAt: 0,
    };
    this.sessions.set(peerId, session);

    const envelope = createMessage(
      'federation.sync',
      this.localPeerId,
      {
        baseVersion: this.graph.getVersion(),
        targetVersion: this.graph.getVersion(),
        patches: [{
          op: 'fullSnapshot',
          serializedGraph: Y.encodeStateAsUpdate(this.graph.doc).toString(),
        }],
      },
      peerId,
    );
    this.dcManager.send(envelope);
  }

  handleSyncMessage(envelope: FederationEnvelope): void {
    const payload = envelope.payload as {
      baseVersion: number;
      targetVersion: number;
      patches: Array<{ op: string; serializedGraph?: string }>;
    };

    const peerId = envelope.senderId;
    let session = this.sessions.get(peerId);
    if (!session) {
      session = { peerId, phase: 'idle', remoteStateVector: null, lastSyncAt: 0 };
      this.sessions.set(peerId, session);
    }

    const fullSnapshot = payload.patches.find((p) => p.op === 'fullSnapshot');
    if (fullSnapshot?.serializedGraph) {
      const update = new Uint8Array(
        fullSnapshot.serializedGraph.split('').map((c) => c.charCodeAt(0)),
      );
      this.graph.applyUpdate(update);
      session.phase = 'synced';
      session.lastSyncAt = Date.now();

      const localStateVector = this.graph.getStateVector();
      const syncBack = createMessage(
        'federation.sync',
        this.localPeerId,
        {
          baseVersion: this.graph.getVersion(),
          targetVersion: this.graph.getVersion(),
          patches: [{ op: 'fullSnapshot', serializedGraph: Y.encodeStateAsUpdate(this.graph.doc).toString() }],
        },
        peerId,
      );
      this.dcManager.send(syncBack);
    }
  }

  private broadcastLocalChanges(): void {
    const current = this.graph.exportGraph();
    const base = createSemanticGraph();
    base.version = current.version - 1;
    const diff = computeDiff(base, current, this.localPeerId);

    if (diff.patches.length === 0) return;

    for (const [peerId] of this.sessions) {
      const envelope = createMessage(
        'federation.sync',
        this.localPeerId,
        {
          baseVersion: diff.baseVersion,
          targetVersion: diff.targetVersion,
          patches: diff.patches,
        },
        peerId,
      );
      this.dcManager.send(envelope);
    }
  }

  removeSession(peerId: string): void {
    this.sessions.delete(peerId);
  }

  getSyncedPeerCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.phase === 'synced') count++;
    }
    return count;
  }
}
