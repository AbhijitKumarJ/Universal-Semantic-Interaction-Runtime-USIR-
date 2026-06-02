import type { FederationEnvelope } from '../message';
import type { ProvenancePayload } from '../message';
import { SignalingServer } from '../signaling';
import { PeerConnectionManager } from '../connection';
import { DataChannelManager } from '../connection/data-channel';
import { FederatedGraph } from '../graph/federated-graph';
import { SyncProtocol } from '../graph/sync-protocol';
import { ConflictResolver } from '../graph/conflict-resolver';
import { FederatedSnapshotEngine } from '../graph/snapshot-engine';
import { DiscoveryService } from '../discovery/discovery-service';
import { CapabilityAdvertisement } from '../discovery/capability-advertisement';
import { PeerDirectory } from '../discovery/peer-directory';
import { ShareHandler } from '../collaboration/share-handler';
import { DiscussHandler } from '../collaboration/discuss-handler';
import { AnnotateHandler } from '../collaboration/annotate-handler';
import { BroadcastHandler } from '../collaboration/broadcast-handler';
import { L8ToolRegistry } from '../collaboration/tool-registry';
import { MultiPeerMemory } from '../collaboration/multi-peer-memory';
import { ProvenanceBridge } from '../provenance-bridge/provenance-bridge';
import { CrossRuntimeCausalWalker } from '../provenance-bridge/causal-walker';
import { TrustMigration } from '../provenance-bridge/trust-migration';
import { createRemoteCapabilityBridge, type RemoteCapabilityBridge } from '../discovery/remote-capability-bridge';
import type { FederationRuntimeConfig } from './config';

export type FederationState = 'idle' | 'starting' | 'connecting' | 'synced' | 'connected' | 'error' | 'stopping' | 'stopped';

export type FederationLifecycleEvent =
  | { type: 'state_change'; from: FederationState; to: FederationState }
  | { type: 'peer_discovered'; peerId: string }
  | { type: 'peer_connected'; peerId: string }
  | { type: 'peer_disconnected'; peerId: string }
  | { type: 'sync_completed'; peerCount: number }
  | { type: 'graph_updated'; nodeCount: number; version: number }
  | { type: 'intent_received'; intentType: string; fromPeerId: string }
  | { type: 'error'; message: string; error?: Error };

export interface FederatedRuntimeComponents {
  signaling: SignalingServer;
  dcManager: DataChannelManager;
  graph: FederatedGraph;
  syncProtocol: SyncProtocol;
  conflictResolver: ConflictResolver;
  snapshotEngine: FederatedSnapshotEngine;
  discovery: DiscoveryService;
  capabilityAd: CapabilityAdvertisement;
  peerDirectory: PeerDirectory;
  shareHandler: ShareHandler;
  discussHandler: DiscussHandler;
  annotateHandler: AnnotateHandler;
  broadcastHandler: BroadcastHandler;
  l8Tools: L8ToolRegistry;
  multiPeerMemory: MultiPeerMemory;
  provenanceBridge: ProvenanceBridge;
  causalWalker: CrossRuntimeCausalWalker;
  trustMigration: TrustMigration;
  remoteCapabilityBridge: RemoteCapabilityBridge;
}

export class FederatedRuntime {
  readonly config: FederationRuntimeConfig;
  readonly components: FederatedRuntimeComponents;

  private state: FederationState = 'idle';
  private peerConnections: Map<string, PeerConnectionManager> = new Map();
  private observers: Array<(event: FederationLifecycleEvent) => void> = [];
  private started = false;

  constructor(config: FederationRuntimeConfig) {
    this.config = config;
    const signaling = new SignalingServer();
    const dcManager = new DataChannelManager();
    const graph = new FederatedGraph(config.localPeerId);
    const peerDirectory = new PeerDirectory();
    const syncProtocol = new SyncProtocol(graph, dcManager, config.localPeerId);
    const conflictResolver = new ConflictResolver({ preferLocal: true });
    const snapshotEngine = new FederatedSnapshotEngine(graph, { localPeerId: config.localPeerId });
    const discovery = new DiscoveryService(config.localPeerId, signaling);
    const capabilityAd = new CapabilityAdvertisement(config.localPeerId, signaling);
    const shareHandler = new ShareHandler({ localPeerId: config.localPeerId, graph, dcManager, peerDirectory });
    const discussHandler = new DiscussHandler({ localPeerId: config.localPeerId, dcManager, peerDirectory });
    const annotateHandler = new AnnotateHandler({ localPeerId: config.localPeerId, graph, dcManager, peerDirectory });
    const broadcastHandler = new BroadcastHandler({ localPeerId: config.localPeerId, dcManager, peerDirectory });
    const l8Tools = new L8ToolRegistry({ shareHandler, discussHandler, annotateHandler, broadcastHandler });
    const multiPeerMemory = new MultiPeerMemory(config.localPeerId, peerDirectory);
    const provenanceBridge = new ProvenanceBridge({ runtimeId: config.localPeerId, dcManager, peerDirectory });
    const causalWalker = new CrossRuntimeCausalWalker(provenanceBridge.getLocalGraph(), provenanceBridge.getState().anchors);
    const trustMigration = new TrustMigration(config.localPeerId, provenanceBridge.getLocalGraph());
    const remoteCapabilityBridge = createRemoteCapabilityBridge();

    this.components = {
      signaling, dcManager, graph, syncProtocol, conflictResolver, snapshotEngine,
      discovery, capabilityAd, peerDirectory, shareHandler, discussHandler, annotateHandler,
      broadcastHandler, l8Tools, multiPeerMemory, provenanceBridge, causalWalker,
      trustMigration, remoteCapabilityBridge,
    };

    this.setupCapabilities();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.transition('starting');

    try {
      const { signaling, discovery, capabilityAd, provenanceBridge } = this.components;

      const joinPayload = {
        peer: {
          peerId: this.config.localPeerId,
          displayName: this.config.displayName,
          runtimeVersion: this.config.runtimeVersion ?? '0.1.0',
        },
        capabilities: {
          supportedRoles: this.config.supportedRoles,
          supportedLayers: this.config.supportedLayers,
          supportedIntents: this.config.supportedIntents,
        },
      };

      discovery.start(joinPayload);
      this.transition('connecting');

      discovery.observe((event) => {
        switch (event.type) {
          case 'peer_joined':
            this.notify({ type: 'peer_discovered', peerId: event.peerId });
            this.initiatePeerConnection(event.peerId, event.payload).catch((err) => {
              this.notify({ type: 'error', message: `Failed to connect to ${event.peerId}`, error: err });
            });
            break;
          case 'peer_left':
            this.handlePeerDisconnect(event.peerId);
            break;
        }
      });

      capabilityAd.onRemoteCapability((peerId, caps) => {
        this.components.peerDirectory.updateCapabilities(peerId, caps);
      });

      this.components.dcManager.onMessage((envelope: FederationEnvelope) => {
        this.handleIncomingMessage(envelope);
      });

      provenanceBridge.start();

      this.setupTrustPolicies();

      this.started = true;
      this.transition('synced');
      this.transition('connected');

    } catch (err) {
      this.transition('error');
      this.notify({ type: 'error', message: 'Failed to start federated runtime', error: err as Error });
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.transition('stopping');

    for (const [, pc] of this.peerConnections) {
      await pc.disconnect();
    }
    this.peerConnections.clear();

    this.components.discovery.stop();
    this.components.provenanceBridge.stop();
    this.components.peerDirectory.clear();
    this.components.signaling.clear();

    this.started = false;
    this.transition('stopped');
  }

  getState(): FederationState {
    return this.state;
  }

  getConnectedPeerCount(): number {
    let count = 0;
    for (const [, pc] of this.peerConnections) {
      if (pc.isConnected()) count++;
    }
    return count;
  }

  getPeerConnection(peerId: string): PeerConnectionManager | undefined {
    return this.peerConnections.get(peerId);
  }

  observe(handler: (event: FederationLifecycleEvent) => void): () => void {
    this.observers.push(handler);
    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  private async initiatePeerConnection(peerId: string, joinPayload: { peer: { peerId: string; displayName: string } }): Promise<void> {
    if (this.peerConnections.has(peerId)) return;
    if (this.peerConnections.size >= this.config.maxPeers) return;

    const pc = new PeerConnectionManager({
      peerId: this.config.localPeerId,
      remotePeerId: peerId,
      signaling: this.components.signaling,
      iceServers: this.buildIceServers(),
      onStateChange: (state) => {
        if (state === 'disconnected' || state === 'error') {
          this.handlePeerDisconnect(peerId);
        }
      },
      onMessage: (envelope) => {
        this.handleIncomingMessage(envelope);
      },
      onError: (err) => {
        this.notify({ type: 'error', message: `Peer connection error with ${peerId}`, error: err });
      },
    });

    this.peerConnections.set(peerId, pc);

    const peerEntry = {
      peerId,
      displayName: joinPayload.peer.displayName,
      runtimeVersion: '0.1.0',
      capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
      addresses: [],
      trustLevel: 'anonymous' as const,
      metadata: {},
      lastSeen: Date.now(),
      status: 'online' as const,
    };
    this.components.peerDirectory.register(peerEntry);

    await pc.connectAsOfferer();
    this.components.syncProtocol.initiateSync(peerId);
    this.notify({ type: 'peer_connected', peerId });
  }

  private handlePeerDisconnect(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.disconnect().catch(() => {});
      this.peerConnections.delete(peerId);
    }
    this.components.peerDirectory.updateStatus(peerId, 'offline');
    this.components.syncProtocol.removeSession(peerId);
    this.notify({ type: 'peer_disconnected', peerId });
  }

  private handleIncomingMessage(msg: FederationEnvelope): void {
    switch (msg.type) {
      case 'federation.sync':
        this.components.syncProtocol.handleSyncMessage(msg);
        this.notify({
          type: 'graph_updated',
          nodeCount: this.components.graph.getNodeCount(),
          version: this.components.graph.getVersion(),
        });
        break;

      case 'federation.provenance':
        this.components.provenanceBridge.handleRemoteProvenance({
          senderId: msg.senderId,
          payload: msg.payload as ProvenancePayload,
        });
        break;

      case 'federation.intent': {
        const payload = msg.payload as { intentType: string; serializedEnvelope: string };
        this.notify({ type: 'intent_received', intentType: payload.intentType, fromPeerId: msg.senderId });
        break;
      }

      case 'federation.capability':
        this.components.capabilityAd.handleCapabilityMessage(msg);
        break;

      case 'federation.join':
      case 'federation.leave':
        break;
    }
  }

  private buildIceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [];
    if (this.config.stunServers) {
      for (const url of this.config.stunServers) {
        servers.push({ urls: url });
      }
    }
    if (this.config.turnServers) {
      for (const s of this.config.turnServers) {
        servers.push({ urls: s.urls, username: s.username, credential: s.credential });
      }
    }
    return servers;
  }

  private setupCapabilities(): void {
    if (this.config.supportedRoles.length > 0) {
      for (const role of this.config.supportedRoles) {
        this.components.capabilityAd.addSupportedRole(role);
      }
    }
    if (this.config.supportedLayers.length > 0) {
      for (const layer of this.config.supportedLayers) {
        this.components.capabilityAd.addSupportedLayer(layer);
      }
    }
    this.components.capabilityAd.addSupportedIntent('intent.collaboration.share');
    this.components.capabilityAd.addSupportedIntent('intent.collaboration.discuss');
    this.components.capabilityAd.addSupportedIntent('intent.collaboration.annotate');
    this.components.capabilityAd.addSupportedIntent('intent.collaboration.broadcast');
  }

  private setupTrustPolicies(): void {
    for (const tp of this.config.trustPolicies) {
      this.components.trustMigration.setTrustPolicy(tp.runtimeId, tp.policy);
    }
    for (const rt of this.config.trustedRuntimes) {
      this.components.trustMigration.addTrustedRuntime(rt);
    }
  }

  private transition(to: FederationState): void {
    const from = this.state;
    this.state = to;
    this.notify({ type: 'state_change', from, to });
  }

  private notify(event: FederationLifecycleEvent): void {
    for (const h of this.observers) h(event);
  }
}
