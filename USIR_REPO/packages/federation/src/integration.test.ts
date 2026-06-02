import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignalingServer } from './signaling';
import { FederatedGraph } from './graph/federated-graph';
import { SyncProtocol } from './graph/sync-protocol';
import { PeerDirectory } from './discovery/peer-directory';
import { CapabilityAdvertisement } from './discovery/capability-advertisement';
import { DiscoveryService } from './discovery/discovery-service';
import { ShareHandler } from './collaboration/share-handler';
import { DiscussHandler } from './collaboration/discuss-handler';
import { AnnotateHandler } from './collaboration/annotate-handler';
import { BroadcastHandler } from './collaboration/broadcast-handler';
import { MultiPeerMemory } from './collaboration/multi-peer-memory';
import { ProvenanceBridge } from './provenance-bridge/provenance-bridge';
import { CrossRuntimeCausalWalker } from './provenance-bridge/causal-walker';
import { TrustMigration } from './provenance-bridge/trust-migration';
import { createRemoteCapabilityBridge } from './discovery/remote-capability-bridge';
import type { IntentActor } from '@usir/protocol/intents';

class InMemoryChannel {
  private handlers: Array<(msg: unknown) => void> = [];

  onMessage(h: (msg: unknown) => void): void {
    this.handlers.push(h);
  }

  send(msg: unknown): void {
    for (const h of this.handlers) h(msg);
  }
}

class InMemoryDCManager {
  private channels = new Map<string, InMemoryChannel>();
  private peers: Map<string, InMemoryDCManager> = new Map();
  private messageHandler?: (msg: unknown) => void;

  constructor(public peerId: string) {}

  registerPeer(peerId: string, dc: InMemoryDCManager): void {
    this.peers.set(peerId, dc);
    const ch = new InMemoryChannel();
    ch.onMessage((msg) => this.messageHandler?.(msg));
    this.channels.set(peerId, ch);
  }

  send(envelope: { type: string; senderId: string; targetId?: string }): void {
    if (envelope.targetId) {
      const peerDc = this.peers.get(envelope.targetId);
      if (peerDc) {
        peerDc.receive({ ...envelope, senderId: this.peerId });
      }
    }
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.messageHandler = handler;
  }

  receive(msg: unknown): void {
    this.messageHandler?.(msg);
  }
}

function createTestActor(id: string): IntentActor {
  return { type: 'user', id };
}

describe('Federation Integration', () => {
  let signaling: SignalingServer;
  let peerA: PeerDirectory;
  let peerB: PeerDirectory;
  let graphA: FederatedGraph;
  let graphB: FederatedGraph;
  let dcA: InMemoryDCManager;
  let dcB: InMemoryDCManager;
  let provA: ProvenanceBridge;
  let provB: ProvenanceBridge;

  beforeAll(() => {
    signaling = new SignalingServer();
    peerA = new PeerDirectory();
    peerB = new PeerDirectory();

    graphA = new FederatedGraph('peer-a');
    graphB = new FederatedGraph('peer-b');

    dcA = new InMemoryDCManager('peer-a');
    dcB = new InMemoryDCManager('peer-b');
    dcA.registerPeer('peer-b', dcB);
    dcB.registerPeer('peer-a', dcA);

    provA = new ProvenanceBridge({ runtimeId: 'peer-a', dcManager: dcA as unknown as never, peerDirectory: peerA });
    provB = new ProvenanceBridge({ runtimeId: 'peer-b', dcManager: dcB as unknown as never, peerDirectory: peerB });
  });

  describe('SignalingServer', () => {
    it('relays messages between peers', () => {
      const received: string[] = [];
      signaling.register('peer-a', (msg) => received.push(msg.type));
      signaling.register('peer-b', (msg) => received.push(msg.type));

      signaling.send('peer-a', { type: 'federation.hello', senderId: 'peer-b', messageId: 'm1', timestamp: Date.now(), payload: {} });
      expect(received).toContain('federation.hello');
    });

    it('broadcasts to all peers except sender', () => {
      const received: string[] = [];
      signaling.register('peer-c', (msg) => received.push(msg.type));
      signaling.register('peer-d', (msg) => received.push(msg.type));

      signaling.broadcast({ type: 'federation.announce', senderId: 'peer-c', messageId: 'm2', timestamp: Date.now(), payload: {} }, 'peer-c');
      expect(received).toContain('federation.announce');
    });
  });

  describe('FederatedGraph CRDT sync across peers', () => {
    it('syncs entities from A to B via Yjs updates', () => {
      graphA.addEntity({ id: 'e1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' });

      const update = graphA.getStateAsUpdate();
      graphB.applyUpdate(update);

      const exportedB = graphB.exportGraph();
      expect(exportedB.nodes.has('e1')).toBe(true);
      expect(exportedB.nodes.get('e1')!.entity.displayName).toBe('foo');
    });

    it('merges concurrent additions from both peers', () => {
      graphA.addEntity({ id: 'e1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' });
      graphB.addEntity({ id: 'e2', role: 'class', displayName: 'Bar', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' });

      graphA.applyUpdate(graphB.getStateAsUpdate());
      graphB.applyUpdate(graphA.getStateAsUpdate());

      const exportedA = graphA.exportGraph();
      const exportedB = graphB.exportGraph();

      expect(exportedA.nodes.size).toBe(2);
      expect(exportedB.nodes.size).toBe(2);
    });
  });

  describe('PeerDirectory', () => {
    it('tracks peers and supports filtered queries', () => {
      peerA.register({
        peerId: 'peer-b',
        displayName: 'Runtime B',
        runtimeVersion: '0.1.0',
        capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
        addresses: [],
        trustLevel: 'anonymous',
        metadata: {},
        lastSeen: Date.now(),
        status: 'online',
      });

      expect(peerA.getPeer('peer-b')).toBeDefined();
      expect(peerA.list({ status: 'online' })).toHaveLength(1);
      expect(peerA.list({ status: 'offline' })).toHaveLength(0);
    });
  });

  describe('DiscoveryService', () => {
    it('discovers peers via signaling server', () => {
      const discovered: string[] = [];
      const discoveryA = new DiscoveryService('peer-a', signaling);
      discoveryA.observe((event) => {
        if (event.type === 'peer_joined') discovered.push(event.peerId);
      });

      const discoveryB = new DiscoveryService('peer-b', signaling);
      discoveryB.start({
        peer: { peerId: 'peer-b', displayName: 'Runtime B', runtimeVersion: '0.1.0' },
        capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
      });

      discoveryA.start({
        peer: { peerId: 'peer-a', displayName: 'Runtime A', runtimeVersion: '0.1.0' },
        capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
      });

      expect(discoveryA.isPeerKnown('peer-b')).toBe(true);
      expect(discoveryA.getKnownPeers()).toContain('peer-b');
    });
  });

  describe('ShareHandler', () => {
    it('shares an entity with a collaborator', async () => {
      const peerDir = new PeerDirectory();
      peerDir.register({
        peerId: 'peer-b', displayName: 'Runtime B', runtimeVersion: '0.1.0',
        capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
        addresses: [], trustLevel: 'anonymous', metadata: {}, lastSeen: Date.now(), status: 'online',
      });

      const handler = new ShareHandler({
        localPeerId: 'peer-a',
        graph: graphA,
        dcManager: dcA as unknown as never,
        peerDirectory: peerDir,
      });

      const result = await handler.execute({
        type: 'intent.collaboration.share',
        intentId: 'intent-1',
        timestamp: Date.now(),
        actor: createTestActor('user-a'),
        confidence: 1,
        target: [{ id: 'e1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' }],
        collaboratorId: 'peer-b',
        permissions: ['read', 'comment'],
      });

      expect(result.success).toBe(true);
      expect(result.collaboratorId).toBe('peer-b');
    });
  });

  describe('DiscussHandler', () => {
    it('creates discussion threads', async () => {
      const handler = new DiscussHandler({
        localPeerId: 'peer-a',
        dcManager: dcA as unknown as never,
        peerDirectory: peerA,
      });

      const result = await handler.execute({
        type: 'intent.collaboration.discuss',
        intentId: 'intent-2',
        timestamp: Date.now(),
        actor: createTestActor('user-a'),
        confidence: 1,
        target: { id: 'e1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' },
        message: 'What do you think about this?',
        preferredModality: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBeTruthy();
      expect(result.messageId).toBeTruthy();
    });
  });

  describe('AnnotateHandler', () => {
    it('annotates entities in the graph', async () => {
      const handler = new AnnotateHandler({
        localPeerId: 'peer-a',
        graph: graphA,
        dcManager: dcA as unknown as never,
        peerDirectory: peerA,
      });

      const result = await handler.execute({
        type: 'intent.collaboration.annotate',
        intentId: 'intent-3',
        timestamp: Date.now(),
        actor: createTestActor('user-a'),
        confidence: 1,
        target: { id: 'e1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: Date.now(), source: 'test' },
        annotation: 'This function needs refactoring',
      });

      expect(result.success).toBe(true);
      expect(result.annotationId).toBeTruthy();
      expect(result.entityId).toBe('e1');
    });
  });

  describe('BroadcastHandler', () => {
    it('broadcasts to online peers', async () => {
      const peerDir = new PeerDirectory();
      peerDir.register({
        peerId: 'peer-b', displayName: 'Runtime B', runtimeVersion: '0.1.0',
        capabilities: { supportedRoles: [], supportedLayers: [], supportedIntents: [] },
        addresses: [], trustLevel: 'anonymous', metadata: {}, lastSeen: Date.now(), status: 'online',
      });

      const handler = new BroadcastHandler({
        localPeerId: 'peer-a',
        dcManager: dcA as unknown as never,
        peerDirectory: peerDir,
      });

      const result = await handler.execute({
        type: 'intent.collaboration.broadcast',
        intentId: 'intent-4',
        timestamp: Date.now(),
        actor: createTestActor('user-a'),
        confidence: 1,
        annotationId: 'anno-1',
        recipients: ['peer-b'],
        modality: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.sentTo).toContain('peer-b');
    });
  });

  describe('ProvenanceBridge', () => {
    it('records and syncs provenance across peers', () => {
      provA.recordLocal({
        provenanceId: 'prov-1',
        intentId: 'intent-share-1',
        intentSnapshot: { type: 'intent.collaboration.share', intentId: 'intent-share-1', timestamp: Date.now(), actor: createTestActor('user-a'), confidence: 1 },
        actor: { type: 'user', id: 'user-a' },
        rationale: { type: 'user-requested', rawInput: 'share this', interpretedIntent: 'share' },
        authorization: { type: 'approved', approvalIntentId: 'approve-1', approverId: 'user-a', at: Date.now() },
        causalParents: [],
        timestamp: Date.now(),
        contentHashBefore: 'abc',
        contentHashAfter: 'def',
        semanticDiff: { entityId: 'e1', entityBefore: {}, entityAfter: {}, changedFields: [] },
      });

      const graph = provA.getLocalGraph();
      expect(graph.nodes.has('prov-1')).toBe(true);
      expect(graph.nodes.get('prov-1')!.runtimeId).toBe('peer-a');
    });

    it('creates anchors for cross-runtime links', () => {
      provA.handleRemoteProvenance({
        senderId: 'peer-b',
        payload: {
          runtimeId: 'peer-b',
          nodes: [{
            provenanceId: 'prov-b-1',
            intentId: 'intent-b-1',
            entityId: 'e2',
            intentType: 'intent.manipulation.edit',
            actorId: 'user-b',
            timestamp: Date.now(),
            contentHashBefore: 'aaa',
            contentHashAfter: 'bbb',
            causalParents: [],
          }],
        },
      });

      const anchors = provA.getAnchorsForRemotePeer('peer-b');
      expect(anchors.length).toBeGreaterThan(0);
    });
  });

  describe('CrossRuntimeCausalWalker', () => {
    it('walks causal chains across runtimes via anchors', () => {
      const graph = provA.getLocalGraph();
      const anchorsMap = new Map(provA.getAnchors().map((a) => [a.anchorId, a]));
      const walker = new CrossRuntimeCausalWalker(graph, anchorsMap);

      const chain = walker.walkEntityHistory('e1');
      expect(chain.nodes.length).toBeGreaterThan(0);
      expect(chain.totalHops).toBeGreaterThan(0);
    });
  });

  describe('TrustMigration', () => {
    it('verifies trust chains', () => {
      const graph = provA.getLocalGraph();
      const trust = new TrustMigration('peer-a', graph);

      trust.addTrustedRuntime('peer-b');
      expect(trust.isRuntimeTrusted('peer-b')).toBe(true);
      expect(trust.isRuntimeTrusted('peer-c')).toBe(false);
    });
  });

  describe('MultiPeerMemory', () => {
    it('records and resolves remote turns', () => {
      const mem = new MultiPeerMemory('peer-a', peerA);

      mem.recordRemoteTurn({
        turnId: 'turn-1',
        peerId: 'peer-b',
        timestamp: Date.now(),
        rawInput: 'Can you look at function foo?',
        resolvedIntentId: 'intent-2',
        touchedEntityIds: ['e1'],
      });

      const snapshot = mem.snapshot();
      expect(snapshot.recentRemoteTurns).toHaveLength(1);
      expect(snapshot.knownPeers).toBeDefined();
    });
  });
});
