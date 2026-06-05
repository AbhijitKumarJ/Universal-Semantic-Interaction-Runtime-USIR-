# Part 11: Federation — P2P Semantic Graphs Over WebRTC

> **Series:** Decoding the Post-GUI Runtime | **Act III — The Horizon**
> *← [Part 10: The VS Code Extension Anatomy](/part-10-vscode-anatomy) | [Part 12: The Capability Marketplace](/part-12-capability-marketplace) →*

---

Act III opens with the biggest package in the repository.

`@usir/federation` is 4,760 lines of TypeScript, 73 tests, 14 sub-packages, and a single external dependency: `yjs`. It is the largest single component in the entire USIR codebase, larger than the runtime itself, larger than all the adapters combined. This is not a coincidence. If the vision of USIR as described in Acts I and II is a *local* post-GUI runtime — one machine, one user, voice commands driving a personal context graph — then federation is the bet that the interesting future is *networked*: multiple runtimes, multiple users, a shared semantic graph that exists across machines.

This post traces that bet from its architectural foundations to its implementation details to the honest gap between what is built and what would need to exist for it to matter.

---

## What "Federation" Means Here

The word is used in a specific technical sense. In USIR, federation is not a message bus, not a real-time collaboration server, and not a shared database. It is a **peer-to-peer protocol** where each participant runs a full USIR runtime locally, and the runtimes synchronize a *shared semantic graph* over WebRTC data channels using CRDTs.

The design goals encoded in this choice are worth being explicit about:

No central server for runtime state. Any two USIR runtimes can communicate directly once they discover each other. This is the same bet ActivityPub and Nostr make — and for the same reasons: centralization creates single points of failure, privacy risk, and vendor lock-in.

Intent-level rather than keystroke-level. When Alice's runtime sends something to Bob's runtime, it sends `SemanticEntity` objects and resolved intents — not keystrokes, not cursor events, not screen shares. Bob's runtime can render the same entity graph through a completely different modality than Alice's.

Provenance crosses runtime boundaries. A mutation that Alice's LLM router generates and Bob's executor applies needs a complete causal chain, even though the chain spans two machines. The `ProvenanceBridge` makes this work.

The collaboration layer is the intent ontology's L8. The same `ShareIntent`, `DiscussIntent`, `AnnotateIntent`, `BroadcastIntent` types that live in `@usir/protocol/intents` are the primitives that federation handlers process. The federation layer is not a new protocol on top of USIR — it is USIR itself, operating across machines.

---

## The Package Structure

```
packages/federation/src/
├── runtime/           # FederatedRuntime orchestrator + config
├── topology/          # PeerConnectionState machine (9 states, 11 events)
├── signaling/         # SignalingServer (in-memory MVP with JSON persistence)
├── connection/        # PeerConnectionManager + DataChannelManager (5 channels)
├── graph/             # FederatedGraph (Yjs CRDT), SyncProtocol, ConflictResolver
├── snapshot/          # FederatedSnapshotDiff — patch-based graph sync
├── discovery/         # DiscoveryService, PeerDirectory, CapabilityAdvertisement
├── collaboration/     # L8 handlers: Share, Discuss, Annotate, Broadcast, MultiPeerMemory
├── provenance-bridge/ # ProvenanceBridge, CrossRuntimeCausalWalker, TrustMigration
├── message/           # FederationEnvelope, typed message constructors
├── peer/              # PeerEntry, peer identity types
├── transport/         # FederationTransport interface (pluggable transport abstraction)
├── provenance/        # ProvenanceAnchor, ProvenanceBridgeState types
└── index.ts
```

The package exports 14 named sub-paths. Each sub-path is independently importable, so a consumer who only wants to use the `ProvenanceBridge` does not need to import the entire `FederatedRuntime`. This is the correct packaging strategy for a protocol library — consumers may use federation incrementally.

---

## The FederatedRuntime State Machine

`FederatedRuntime` is the orchestrator. Its state machine has seven states:

```typescript
export type FederationState =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'synced'
  | 'connected'
  | 'error'
  | 'stopping'
  | 'stopped';
```

The flow on `start()`:

```typescript
async start(): Promise<void> {
  if (this.started) return;
  this.transition('starting');

  discovery.start(joinPayload);
  this.transition('connecting');

  discovery.observe((event) => {
    switch (event.type) {
      case 'peer_joined':
        this.initiatePeerConnection(event.peerId, event.payload);
        break;
      case 'peer_left':
        this.handlePeerDisconnect(event.peerId);
        break;
    }
  });

  provenanceBridge.start();
  this.setupTrustPolicies();

  this.started = true;
  this.transition('synced');
  this.transition('connected');
}
```

The state progression `connecting → synced → connected` happens synchronously in the current implementation. This is slightly misleading — the transition to `synced` fires before any actual graph sync with a peer has occurred. What it means here is "local state initialized, ready for peers" rather than "synchronized with at least one peer." When real peer sync completes, the `sync_completed` lifecycle event fires, but the `FederationState` does not advance further. The state machine's `synced` and `connected` states essentially overlap in the current model — a distinction that would matter more if there were a "waiting for first sync before taking commands" requirement.

The `FederatedRuntimeComponents` struct exposes all seventeen internal subsystems as public properties:

```typescript
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
```

All subsystems are instantiated in the constructor, wired by hand, and exposed publicly. This is not dependency injection — it is structural composition. The tradeoff: the wiring is readable and testable (you can reach into `components.graph` directly in tests), but it cannot be customized without subclassing or modifying the constructor. For the pre-alpha this is fine. A production version would want a factory pattern that allows component substitution (e.g., replacing the in-memory `SignalingServer` with a WebSocket-backed one) without forking the constructor.

---

## The Peer Connection State Machine

The per-peer connection lifecycle is a separate, more granular state machine in `topology/index.ts`:

```typescript
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
```

The full transition table is explicit and exhaustive:

```typescript
const TRANSITIONS: Record<PeerConnectionState, Partial<Record<PeerConnectionEvent, PeerConnectionState>>> = {
  idle: { connect_requested: 'connecting' },
  connecting: { offer_sent: 'awaiting_answer', error_occurred: 'error' },
  awaiting_answer: { answer_received: 'connected', error_occurred: 'error', heartbeat_timeout: 'disconnected' },
  connected: { sync_started: 'syncing', disconnect_requested: 'disconnecting', heartbeat_timeout: 'disconnected', error_occurred: 'error' },
  syncing: { sync_completed: 'synced', sync_failed: 'connected', error_occurred: 'error' },
  synced: { sync_started: 'syncing', disconnect_requested: 'disconnecting', heartbeat_timeout: 'disconnected', error_occurred: 'error' },
  disconnecting: { disconnected: 'disconnected', error_occurred: 'error' },
  disconnected: { connect_requested: 'connecting' },
  error: { connect_requested: 'connecting', disconnect_requested: 'disconnected' },
};
```

And the transition function throws on invalid transitions rather than silently ignoring them:

```typescript
export function transitionState(current: PeerConnectionState, event: PeerConnectionEvent): PeerConnectionState {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    throw new Error(`Invalid transition: ${current} -> ${event}`);
  }
  return next;
}
```

This is the right design for a connection lifecycle. An event callback model (the obvious alternative) would let you call `onConnected()` when you are already connected, which is a bug that only manifests under race conditions. The state machine makes invalid transitions loudly fail, which is far preferable.

The `isConnected` helper:

```typescript
export function isConnected(state: PeerConnectionState): boolean {
  return state === 'connected' || state === 'syncing' || state === 'synced';
}
```

Three states are "connected" in the sense of "data channels open and messages can flow." The `syncing` state is included because a sync operation does not close the data channels — you can still receive intents while a graph sync is in progress.

---

## The SignalingServer — MVP and Its Limits

WebRTC peers cannot directly initiate connections without a signaling channel to exchange SDP offers, answers, and ICE candidates. The `SignalingServer` is that channel.

In the current implementation, it is entirely in-memory:

```typescript
export class SignalingServer {
  private peers: Map<string, SignalingPeer> = new Map();
  private messageLog: FederationEnvelope[] = [];
  private maxLogSize = 1000;

  register(peerId: string, send: SignalingMessageHandler): void {
    this.peers.set(peerId, { peerId, send, connectedAt: Date.now() });
  }

  send(targetPeerId: string, envelope: FederationEnvelope): boolean {
    const peer = this.peers.get(targetPeerId);
    if (!peer) return false;
    peer.send(envelope);
    this.log(envelope);
    return true;
  }
}
```

Each "peer" in the signaling server is identified by `peerId` and backed by a `send: SignalingMessageHandler` — a callback. When `PeerConnectionManager` wants to relay an SDP offer to a remote peer, it calls `signaling.send(remotePeerId, offerEnvelope)`. The signaling server looks up the remote peer's callback and invokes it. This works perfectly in-process (and is why the integration tests work without any network infrastructure), but it means two USIR runtimes running on different machines cannot signal each other. They share no process.

The `SignalingServer` does have basic persistence — it can `save()` its message log to disk and `load()` it back — but the message log is an audit trail, not the peer registry. Peer registrations are in-memory and lost on process restart.

The `FederationTransport` interface at `transport/index.ts` is the abstraction designed to solve this:

```typescript
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

export interface TransportConfig {
  peerId: string;
  signalingUrl: string;
  stunServers?: string[];
  turnServers?: Array<{ url: string; username?: string; credential?: string }>;
}
```

`signalingUrl` is the hook for a production deployment: point it at a WebSocket server and swap the `SignalingServer` in-process implementation for a `WebSocketTransport` that connects to the external server. The interface is the right shape. The implementation is not there — `FederationTransport` is a type definition with no production implementation.

---

## The Five Data Channels

Once WebRTC signaling completes and the peer connection is established, communication happens over five labeled `RTCDataChannel` instances, each with different reliability semantics:

```typescript
const CHANNEL_SPECS: Record<ChannelPurpose, ChannelSpec> = {
  control:    { label: 'usir-control',    ordered: true,  maxRetransmits: 3 },
  sync:       { label: 'usir-sync',       ordered: true,  maxRetransmits: 5 },
  intent:     { label: 'usir-intent',     ordered: true,  maxRetransmits: 2 },
  provenance: { label: 'usir-provenance', ordered: true,  maxRetransmits: 2 },
  stream:     { label: 'usir-stream',     ordered: false, maxRetransmits: 0 },
};
```

The `stream` channel is the only unordered, unreliable channel — modeled after UDP. This is correct for streaming audio or telemetry where old data is less useful than new data. The four ordered channels use different `maxRetransmits` values, which maps to WebRTC's `maxRetransmits` parameter: the number of times a lost packet is retransmitted before giving up. `sync` gets 5 retransmits because a lost graph state update cannot be recovered without full re-sync. `intent` gets 2 because a missed intent message is better surfaced as an error than silently retransmitted indefinitely.

`DataChannelManager` routes outgoing messages to the correct channel by message type:

```typescript
const MESSAGE_TO_CHANNEL: Record<FederationMessageType, ChannelPurpose> = {
  'federation.offer':      'control',
  'federation.answer':     'control',
  'federation.ice':        'control',
  'federation.sync':       'sync',
  'federation.intent':     'intent',
  'federation.provenance': 'provenance',
  'federation.heartbeat':  'control',
  'federation.capability': 'control',
  'federation.error':      'control',
};
```

And it handles the pre-connection timing problem with a pending buffer:

```typescript
send(envelope: FederationEnvelope): void {
  const purpose = MESSAGE_TO_CHANNEL[envelope.type] ?? 'control';
  const channel = this.channels.get(purpose);
  if (channel && channel.isOpen()) {
    channel.send(envelope);
  } else {
    if (this.pendingBuffer.length < this.maxBufferSize) {
      this.pendingBuffer.push({ purpose, envelope });
    }
  }
}
```

Messages sent before the channel is open are buffered up to `maxBufferSize: 500`, then flushed when `registerChannel` is called. This is the correct design for the race condition between "connection established" and "data channels open" — in WebRTC, these are not simultaneous events.

---

## The Heartbeat and Reconnection Protocol

`PeerConnectionManager` maintains connection health through a 5-second heartbeat:

```typescript
private startHeartbeat(): void {
  this.heartbeatInterval = setInterval(() => {
    this.heartbeatSeq++;
    this.missedHeartbeats++;
    const envelope = createMessage('federation.heartbeat', this.localPeerId, {
      sessionId: `${this.localPeerId}:${this.remotePeerId}`,
      seq: this.heartbeatSeq,
    }, this.remotePeerId);
    const sent = this.signaling.send(this.remotePeerId, envelope);
    if (!sent || this.missedHeartbeats > this.maxMissedHeartbeats) {
      this.transition('heartbeat_timeout');
      this.reconnect();
    }
  }, 5000);
}
```

The heartbeat uses the signaling server, not the data channels — because if the data channels are down (the common failure mode), you need the heartbeat to succeed via the signaling path to initiate reconnection. Reconnection uses exponential backoff:

```typescript
async reconnect(): Promise<void> {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    this.config.onError?.(new Error(`Max reconnection attempts reached for ${this.remotePeerId}`));
    return;
  }
  this.reconnectAttempts++;
  await this.disconnect();
  await new Promise((r) => setTimeout(r, this.reconnectDelay * this.reconnectAttempts));
  if (this.isOfferer) await this.connectAsOfferer();
}
```

`maxReconnectAttempts: 5`, `reconnectDelay: 1000ms`. With `reconnectAttempts` multiplied by `reconnectDelay`, the delays are 1s, 2s, 3s, 4s, 5s before giving up. This is linear backoff, not exponential — the naming suggests exponential but the implementation is linear. For a local network connection that drops momentarily, 5 linear attempts at 1-second intervals is probably adequate. For a high-latency or unreliable internet connection, true exponential backoff with jitter would be more appropriate.

---

## The Yjs CRDT Layer: FederatedGraph

This is the technical heart of federation. `FederatedGraph` wraps a `Y.Doc` — a Yjs CRDT document — and maps the `SemanticGraph` data model into Yjs types.

```typescript
export class FederatedGraph {
  readonly doc: Y.Doc;
  readonly peerId: string;

  private nodesMap: Y.Map<Y.Map<unknown>>;  // entityId → YNodeMap
  private edgesArray: Y.Array<Y.Map<unknown>>;
  private metaMap: Y.Map<unknown>;
}
```

The structure is a `Y.Map` keyed by entity ID for nodes, and a `Y.Array` for edges. The choice of `Y.Map` for nodes means concurrent node additions from different peers cannot conflict — each peer owns its own key namespace. The choice of `Y.Array` for edges means concurrent edge additions commute — appending an edge from peer A and peer B simultaneously produces an array containing both, in some order, with no data loss.

### The JSON Serialization Decision

One implementation detail deserves attention. Complex nested fields on `SemanticEntity` — `context`, `spatial`, `attributes`, `relations`, `audioFingerprint` — are stored not as nested Yjs types but as **JSON strings**:

```typescript
private setYNode(id: string, node: SemanticNode): void {
  // ...
  yNode.set('context',          node.entity.context ? JSON.stringify(node.entity.context) : '{}');
  yNode.set('spatial',          node.entity.spatial ? JSON.stringify(node.entity.spatial) : 'null');
  yNode.set('attributes',       JSON.stringify(node.entity.attributes));
  yNode.set('relations',        JSON.stringify(node.entity.relations));
  yNode.set('audioFingerprint', node.entity.audioFingerprint ? JSON.stringify(node.entity.audioFingerprint) : 'null');
}
```

The code comments acknowledge this explicitly: "All sub-objects stored as JSON strings to avoid deep Yjs type nesting." This is the correct MVP trade-off. Yjs supports arbitrarily nested `Y.Map` and `Y.Array` trees, and using them for every sub-object would give field-level merge semantics — if Alice changes the `x` coordinate of an entity's `spatial` field while Bob changes the `y` coordinate simultaneously, both changes survive. With JSON strings, the last writer wins at the whole-field level: Alice's spatial update and Bob's spatial update cannot both survive a concurrent edit. One overwrites the other.

Whether this matters in practice depends on how often two peers concurrently edit the same sub-field of the same entity. For developer collaboration use cases (the primary scenario), this is probably rare enough that the simplicity is worth the trade-off. For real-time spatial coordination in XR (where spatial coordinates change continuously on both ends), LWW at the field level would cause constant data loss.

### Applying Remote Updates

When a peer broadcasts a Yjs state update, the receiving end applies it via:

```typescript
applyUpdate(update: Uint8Array): void {
  Y.applyUpdate(this.doc, update, 'remote');
}
```

The second argument is the transaction origin. The `FederatedGraph` constructor filters out its own updates in the `doc.on('update')` handler:

```typescript
this.doc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === this.peerId) return;  // Skip own updates
  this.notifyObservers({ type: 'remote_update', update, origin: origin as string });
});
```

This is how Yjs-based sync avoids echo loops: when you receive a remote update and apply it, the resulting `doc.on('update')` event has `origin === 'remote'`, which is not equal to `this.peerId`, so observers are notified. When you make a local edit inside `this.doc.transact(() => {...}, this.peerId)`, the update event fires with `origin === this.peerId`, which is filtered out.

### The State Vector Protocol

Yjs uses state vectors for efficient sync. Rather than sending the full document on every sync, peers exchange state vectors to determine the minimal diff:

```typescript
getSyncMessage(remoteStateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
}

getStateVector(): Uint8Array {
  return Y.encodeStateVector(this.doc);
}

getStateAsUpdate(): Uint8Array {
  return Y.encodeStateAsUpdate(this.doc);
}
```

The sync protocol works as follows: A sends its state vector to B. B encodes only the updates A is missing (using `encodeStateAsUpdate(doc, aStateVector)`) and sends them back. A applies the diff. The result is A and B have identical documents after two messages — not a full document exchange.

---

## The Sync Protocol and Conflict Resolver

`SyncProtocol` (at `graph/sync-protocol.ts`) orchestrates the state vector exchange. It manages per-peer sync sessions and handles the `federation.sync` message type.

`ConflictResolver` (`graph/conflict-resolver.ts`) is initialized with:

```typescript
const conflictResolver = new ConflictResolver({ preferLocal: true });
```

`preferLocal: true` means that when two simultaneous edits conflict at the Yjs level and LWW must pick a winner, the local peer's edit takes precedence. This is a common default in collaborative editing tools — you trust your own edits more than remote edits you cannot verify. It is also the source of the "known hard case" described in the series plan:

> *If two users simultaneously rename the same entity to different values and both are "correct" in their local contexts, LWW will silently discard one.*

The `preferLocal: true` setting means Alice's rename wins on Alice's machine and Bob's rename wins on Bob's machine — after sync, the two runtimes have diverged. Yjs's LWW at the string-field level means one of the two updates will eventually overwrite the other based on the Yjs clock comparison, but neither Alice nor Bob is notified that their edit lost.

The `ConflictResolver` type is present in the `FederatedRuntimeComponents` struct but its output is not actually used in the current `handleIncomingMessage` dispatch path in `FederatedRuntime`. Conflict resolution is handled implicitly by Yjs's LWW semantics rather than by the `ConflictResolver` class. The `ConflictResolver` class exists, has tests, and is wired up — but it is not called during message handling. This is a gap between the design and the execution.

---

## The Four L8 Collaboration Handlers

The collaboration layer implements the L8 intent layer from the protocol ontology. Each handler takes a typed intent from `@usir/protocol/intents`, executes it locally, and fans it out to relevant peers via `DataChannelManager`.

### ShareHandler

```typescript
async execute(intent: ShareIntent): Promise<ShareResult> {
  const targets = Array.isArray(intent.target) ? intent.target : [intent.target];
  const peer = this.peerDirectory.getPeer(intent.collaboratorId);
  if (!peer) {
    return { success: false, ... error: `Peer ${intent.collaboratorId} not found` };
  }

  for (const target of targets) {
    const entity = this.graph.exportGraph().nodes.get(entityId)?.entity;
    const envelope = createMessage('federation.intent', this.localPeerId, {
      intentType: 'intent.collaboration.share',
      serializedEnvelope: JSON.stringify({ intent, target: entity }),
      originRuntimeId: this.localPeerId,
      ttl: 60,
    }, intent.collaboratorId);
    this.dcManager.send(envelope);
  }
}
```

`ShareHandler` validates that the collaborator exists in the peer directory before sending anything. The `permissions` field on `ShareIntent` defines what the recipient can do with the shared entity: `'read' | 'comment' | 'edit' | 'delegate'`. The `hasPermission()` helper checks these:

```typescript
hasPermission(entityId: string, collaboratorId: string, permission: 'read' | 'comment' | 'edit' | 'delegate'): boolean {
  const perms = this.getPermissions(entityId, collaboratorId);
  return perms !== undefined && perms.includes(permission);
}
```

The permission check is client-side only. A remote peer that receives a shared entity and ignores the permission constraints can do whatever it wants — there is no enforcement at the runtime level. This is appropriate for a trusted-peer model (the initial use case) but inadequate for a public registry model.

### DiscussHandler

`DiscussHandler` maintains per-entity discussion threads. The `findOrCreateThread` method ensures one thread per entity:

```typescript
private findOrCreateThread(entityId: string, entityName: string): DiscussionThread {
  for (const thread of this.threads.values()) {
    if (thread.targetEntityId === entityId) return thread;
  }
  // create new thread keyed to entityId
}
```

`DiscussIntent` carries a `preferredModality: 'voice' | 'text' | 'spatial'` field. The current `DiscussHandler` stores this modality on the message but does not use it to change how the message is delivered. A full implementation would route `voice` modality messages to TTS rendering and `spatial` modality messages to XR anchor placement — but those delivery paths are not yet implemented. The modality preference is preserved in the data model, waiting for the renderers.

### AnnotateHandler

`AnnotateHandler` attaches annotations to entities in the federated graph and broadcasts them to all online peers. The annotation is stored both in a local `Map<string, Annotation>` and written into the `FederatedGraph` via `updateEntity`:

```typescript
this.graph.updateEntity(entityId, [
  { field: 'attributes', value: {
    annotation: intent.annotation,
    annotatedBy: intent.actor.id,
    annotatedAt: annotation.timestamp
  }},
]);
```

Writing the annotation into the graph's `attributes` field means it participates in Yjs sync — remote peers who receive the Yjs state update will see the annotation on the entity. Writing it also into the local `annotations` Map gives the handler fast local lookup without going through Yjs deserialization on every `getAnnotations()` call.

### BroadcastHandler

`BroadcastHandler` is the fan-out primitive. If `intent.recipients` is empty, it broadcasts to all online peers. Otherwise it targets specific peer IDs:

```typescript
if (recipients.length === 0) {
  const onlinePeers = this.peerDirectory.list({ status: 'online' });
  for (const peer of onlinePeers) {
    if (peer.peerId === this.localPeerId) continue;
    // ... send to all
  }
} else {
  for (const recipientId of recipients) {
    const peer = this.peerDirectory.getPeer(recipientId);
    if (peer && peer.status === 'online') {
      // ... send to specific peer
    } else {
      failedTo.push(recipientId);
    }
  }
}
```

The `ttl: 30` field on the broadcast envelope is a time-to-live hint (30 seconds). The current `FederatedRuntime.handleIncomingMessage` does not check TTL — received messages are processed unconditionally. TTL enforcement is part of the "not yet" list.

---

## MultiPeerMemory — Resolving "That" Across Machines

Part 6 covered `InteractionMemory` for single-session, single-user reference resolution. `MultiPeerMemory` extends the same concept to the federated case:

```typescript
export class MultiPeerMemory {
  private remoteTurns: RemoteConversationTurn[] = [];
  private maxHistory = 200;

  resolveRemoteReference(reference: CognitiveReference): RemoteConversationTurn | undefined {
    switch (reference.kind) {
      case 'conversational':
        // walk remoteTurns backward by stepsBack
      case 'temporal':
        return this.remoteTurns[this.remoteTurns.length - 1];
      case 'semantic':
        const desc = reference.description.toLowerCase();
        return this.remoteTurns.slice().reverse().find(
          (t) => t.rawInput.toLowerCase().includes(desc) ||
                 t.touchedEntityIds.some((id) => id.toLowerCase().includes(desc))
        );
    }
  }
}
```

When Alice says "open the file Bob just shared," the `semantic` resolver scans the last 200 remote conversation turns for a turn whose `rawInput` or `touchedEntityIds` match the description. This works if Bob's turn was recently recorded in Alice's `MultiPeerMemory`. It fails if Bob's turn happened before Alice joined the session, or if the description is a paraphrase rather than a lexical match. The `semantic` resolver here is string inclusion — the same fuzzy-but-brittle approach identified in Part 6 for single-user memory, compounded by cross-runtime timing issues.

The `MultiPeerMemorySnapshot` provides a view over the last 50 remote turns to the LLM router:

```typescript
snapshot(): MultiPeerMemorySnapshot {
  return {
    localUserId: this.localPeerId,
    recentRemoteTurns: this.remoteTurns.slice(-50),
    knownPeers: this.peerDirectory.list().map((p) => p.peerId),
  };
}
```

---

## Cross-Runtime Provenance

The `ProvenanceBridge` and `CrossRuntimeCausalWalker` are where the story of Part 5 (L0.5 Provenance) extends into the federated case.

### ProvenanceBridge

The bridge syncs provenance sub-graphs every 10 seconds:

```typescript
const PROVENANCE_SYNC_INTERVAL = 10000;

start(): void {
  this.syncInterval = setInterval(() => {
    this.syncPendingProvenance();
  }, PROVENANCE_SYNC_INTERVAL);
}
```

`syncPendingProvenance` batches all locally-recorded provenance nodes that have not yet been synced, serializes them to `ProvenancePayload`, and fans them out over the `provenance` data channel to all online peers.

When remote provenance arrives, it is translated into local `ProvenanceNode` objects with prefixed IDs (`remote:<originalId>`) to avoid collisions with local IDs:

```typescript
const localNode: ProvenanceNode = {
  provenanceId: `remote:${remoteNode.provenanceId}`,
  // ...
  runtimeId: senderId,
  remoteProvenanceId: remoteNode.provenanceId,
  remoteRuntimeId: senderId,
};
recordProvenance(this.localGraph, localNode);
```

And a `ProvenanceAnchor` is created that explicitly links the local copy to the remote original:

```typescript
const anchor = createAnchor({
  anchorType: 'import',
  localRuntimeId: this.runtimeId,
  localProvenanceId: localNode.provenanceId,   // remote:xyz
  remoteRuntimeId: senderId,
  remoteProvenanceId: remoteNode.provenanceId, // xyz
});
this.state.anchors.set(anchor.anchorId, anchor);
```

### CrossRuntimeCausalWalker

The walker traverses causal chains that cross runtime boundaries using BFS, following anchors when the chain leaves the local graph:

```typescript
walk(provenanceId: string, maxDepth = 100): CrossRuntimeCausalChain {
  const queue = [{ id: provenanceId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const node = this.findNode(id);
    if (!node) continue;

    const isLocal = !id.startsWith('remote:');
    chain.push({ node, runtimeId: node.runtimeId ?? (isLocal ? 'local' : 'remote'), isLocal });

    // Follow causal parents
    for (const parentId of node.causalParents) {
      queue.push({ id: parentId, depth: depth + 1 });
    }

    // Follow anchors to cross runtime boundaries
    const anchor = this.findAnchorForProvenance(id);
    if (anchor) {
      queue.push({ id: `remote:${anchor.remoteProvenanceId}`, depth: depth + 1 });
    }
  }
}
```

The result is a `CrossRuntimeCausalChain` with `spansRuntimes: boolean` and `runtimesInvolved: string[]` — enough information to answer "did this mutation in my workspace originate from an intent that Bob executed on his machine?"

---

## TrustMigration

When one runtime executes an intent based on a plan that was originally authorized by a human on a different runtime, the authorization needs to be verified before execution. `TrustMigration` handles this:

```typescript
export class TrustMigration {
  setTrustPolicy(runtimeId: string, policy: TrustPolicy): void { ... }
  addTrustedRuntime(runtimeId: string): void { ... }
  verifyMigration(request: TrustMigrationRequest): TrustMigrationResult { ... }
  migrateTrustDecision(sourceRuntimeId: string, ...): TrustMigrationResult { ... }
}
```

`TrustPolicy` defines what levels of authorization are accepted from a given runtime: `'accept_all' | 'accept_read_only' | 'reject_all' | 'require_local_approval'`. The default for untrusted runtimes is `reject_all`. Trusted runtimes (configured via `FederationRuntimeConfig.trustedRuntimes`) can have policies elevated to `accept_all` or `accept_read_only`.

This is the right shape for a trust model. It means a user can configure "I trust Bob's runtime to execute read-only intents on my behalf, but anything that mutates state requires my explicit approval." The `require_local_approval` policy routes the migrated trust decision through the local A2U dispatcher — closing the loop with Part 8's trust gate.

---

## The Component Map

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         @usir/federation                                     │
│                                                                              │
│  FederatedRuntime                                                            │
│  ├── SignalingServer  ←─── in-memory MVP (needs WebSocket for multi-machine) │
│  ├── DiscoveryService  ←── broadcasts join/leave over signaling              │
│  ├── PeerDirectory     ←── known peers, capabilities, status                 │
│  ├── CapabilityAdvertisement ←── what this runtime can handle                │
│  │                                                                           │
│  ├── PeerConnectionManager (per peer)                                        │
│  │   ├── RTCPeerConnection  ←── browser WebRTC API                          │
│  │   └── DataChannelManager                                                  │
│  │       ├── usir-control    (ordered, 3 retransmits)                       │
│  │       ├── usir-sync       (ordered, 5 retransmits) ─────────┐           │
│  │       ├── usir-intent     (ordered, 2 retransmits)           │           │
│  │       ├── usir-provenance (ordered, 2 retransmits)           │           │
│  │       └── usir-stream     (unordered, 0 retransmits)         │           │
│  │                                                               │           │
│  ├── FederatedGraph ←── Y.Doc + Y.Map<nodes> + Y.Array<edges>  │           │
│  │   └── SyncProtocol ←── state-vector exchange over usir-sync ─┘           │
│  │                                                                           │
│  ├── L8 Collaboration Layer                                                  │
│  │   ├── ShareHandler                                                        │
│  │   ├── DiscussHandler                                                      │
│  │   ├── AnnotateHandler                                                     │
│  │   ├── BroadcastHandler                                                    │
│  │   └── MultiPeerMemory                                                     │
│  │                                                                           │
│  └── Provenance Layer                                                        │
│      ├── ProvenanceBridge  ←── syncs every 10s, via usir-provenance channel  │
│      ├── CrossRuntimeCausalWalker                                            │
│      └── TrustMigration                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## The Test Coverage

73 tests, none of which exercise real WebRTC. All tests use the in-memory `SignalingServer` directly — two `FederatedRuntime` instances in the same Node.js process, signaling through shared in-memory callbacks.

This is a pragmatic choice: WebRTC in a Node.js test environment requires either a native module (`wrtc`) or a browser automation layer. Neither is ideal for a test suite. The in-memory signaling correctly tests the entire message flow — offer/answer, data channel setup, graph sync, L8 handler dispatch, provenance bridge — without requiring actual peer-to-peer networking. The gap is that ICE negotiation, NAT traversal, and network partition scenarios are completely untested.

The test coverage breakdown from the IMPLEMENTATION.md:

- Integration tests: in-memory signaling, `FederatedGraph` sync, `DiscoveryService`, `ProvenanceBridge`, `CrossRuntimeCausalWalker`, `TrustMigration`, `MultiPeerMemory`
- Integration tests: `ShareHandler`, `DiscussHandler`, `AnnotateHandler`, `BroadcastHandler` dispatch
- Unit tests: `FederatedGraph` CRDT sync, concurrent edits, Yjs update round-trip, observer events

No tests verify the behavior when a peer drops mid-sync, when a `federation.sync` message is received out of order, or when two peers simultaneously make conflicting edits to the same entity's `displayName`. These are the scenarios where the LWW conflict resolution matters most.

---

## Critical Take: Blueprint, Not Product

The series plan's critical take is precise:

> *The in-memory `SignalingServer` is a development convenience. Production deployment requires a persistent signaling server (WebSocket + database). The architecture is sound but the deployment gap (nothing is published to npm, no hosted signaling service exists) means federation is a blueprint, not yet a product.*

The gaps fall into three categories:

**Deployment infrastructure.** The `FederationTransport` interface exists and the `signalingUrl` config field exists. The WebSocket signaling server that `signalingUrl` would connect to does not exist. Without it, any two USIR runtimes on different machines cannot discover each other. This is not a small gap — it is the missing first mile.

**Enterprise network compatibility.** `FederationRuntimeConfig` has `stunServers` and `turnServers` fields. TURN server support matters because WebRTC direct P2P connections fail in symmetric NAT environments (common in enterprise networks with strict firewalls). Without a configured TURN server, federation simply does not work in many corporate environments. TURN relays are also a cost: someone has to run and pay for them.

**The LWW conflict hard case.** Two peers simultaneously rename the same entity produces a silent discard of one name. This is not a catastrophic failure mode — it is a confusing UX where one user's edit disappears without warning. "Intent-aware reconciliation" is mentioned in the architecture docs but not implemented. For developer collaboration use cases, this may be rare enough to tolerate. For the spatial computing or IoT scenarios where entities update continuously, it would be a constant source of dropped data.

**No npm publication.** None of the `@usir/*` packages are published to the npm registry. To use federation, you need to clone the monorepo. This is appropriate for pre-alpha but means the ecosystem effects the federation design depends on — multiple organizations running compatible USIR runtimes — cannot begin to emerge.

The architecture itself is genuinely sound. The Yjs choice is well-precedented (Notion, Linear, and dozens of collaborative tools use Yjs for the same reasons). The five-channel data model is thoughtful. The provenance bridge and causal walker are novel in the space. The `FederationTransport` interface is the correct abstraction point for production deployment.

The distance between "sound architecture" and "deployed product" is, in this case, exactly three things: a WebSocket signaling server, a TURN relay, and an npm publish. These are not architectural challenges. They are engineering and operational work that the pre-alpha correctly defers.

---

*Next: **[Part 12: The Capability Marketplace — An App Store Built on Intents](/part-12-capability-marketplace)** — how `@usir/registry` implements a full capability marketplace with trust scoring, tiered pricing, and publisher payouts, and why the chicken-and-egg problem is the hardest engineering challenge it faces.*

---

**Code touchpoints for this post:**
- `packages/federation/src/runtime/federated-runtime.ts`
- `packages/federation/src/topology/index.ts`
- `packages/federation/src/signaling/index.ts`
- `packages/federation/src/connection/index.ts` (PeerConnectionManager)
- `packages/federation/src/connection/data-channel.ts`
- `packages/federation/src/graph/federated-graph.ts`
- `packages/federation/src/collaboration/share-handler.ts`
- `packages/federation/src/collaboration/discuss-handler.ts`
- `packages/federation/src/collaboration/annotate-handler.ts`
- `packages/federation/src/collaboration/broadcast-handler.ts`
- `packages/federation/src/collaboration/multi-peer-memory.ts`
- `packages/federation/src/provenance-bridge/provenance-bridge.ts`
- `packages/federation/src/provenance-bridge/causal-walker.ts`
- `packages/federation/src/provenance-bridge/trust-migration.ts`
- `packages/federation/src/transport/index.ts`
