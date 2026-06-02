# USIR Federated Runtime — Architecture & Deployment Guide

## Overview

The Federated Runtime (`@usir/federation`) enables multiple USIR runtimes to discover each other, synchronize SemanticGraph state via CRDTs, collaborate through L8 intents, and maintain cross-runtime provenance chains — all in a peer-to-peer topology over WebRTC.

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   USIR Runtime A            │     │   USIR Runtime B            │
│                             │     │                             │
│  ┌───────────────────────┐  │     │  ┌───────────────────────┐  │
│  │ FederatedRuntime      │  │     │  │ FederatedRuntime      │  │
│  │   ├─ DiscoveryService │  │     │  │   ├─ DiscoveryService │  │
│  │   ├─ PeerConnections  │  │     │  │   ├─ PeerConnections  │  │
│  │   ├─ FederatedGraph   │◄─┼─Yjs─┼─►│   ├─ FederatedGraph   │  │
│  │   ├─ ProvenanceBridge │  │     │  │   ├─ ProvenanceBridge │  │
│  │   └─ L8ToolRegistry   │  │     │  │   └─ L8ToolRegistry   │  │
│  └───────────────────────┘  │     │  └───────────────────────┘  │
│                             │     │                             │
└──────────────┬──────────────┘     └──────────────┬──────────────┘
               │                                    │
               └────────── Signaling Server ────────┘
                          (in-memory / relay)
```

## Package Structure

```
packages/federation/
├── src/
│   ├── index.ts                       # Barrel exports (9 modules)
│   ├── peer/                          # FederationPeer identity & types
│   ├── message/                       # FederationMessageType (11 types) + serialization
│   ├── topology/                      # PeerConnectionState machine (10 states, 11 events)
│   ├── snapshot/                      # FederatedSnapshotDiff (computeDiff/applyDiff)
│   ├── provenance/                    # ProvenanceAnchor + bridge state types
│   ├── transport/                     # FederationTransport interface
│   ├── signaling/                     # SignalingServer (in-memory MVP)
│   ├── connection/                    # PeerConnectionManager + DataChannelManager
│   ├── graph/                         # FederatedGraph (Yjs CRDT), SyncProtocol,
│   │                                  #   ConflictResolver, FederatedSnapshotEngine
│   ├── discovery/                     # DiscoveryService, CapabilityAdvertisement,
│   │                                  #   PeerDirectory, RemoteCapabilityBridge
│   ├── collaboration/                 # Share/Discuss/Annotate/Broadcast handlers,
│   │                                  #   L8ToolRegistry, MultiPeerMemory
│   ├── provenance-bridge/            # ProvenanceBridge, CrossRuntimeCausalWalker,
│   │                                  #   TrustMigration
│   ├── runtime/                       # FederatedRuntime orchestrator + config
│   └── *.test.ts                      # Co-located vitest tests
└── package.json                       # @usir/federation, depends on @usir/protocol + yjs
```

## Protocol

### Message Types (`FederationMessageType`)

| Type | Direction | Payload |
|------|-----------|---------|
| `offer` | peer→peer | SDP offer for WebRTC |
| `answer` | peer→peer | SDP answer for WebRTC |
| `ice_candidate` | peer→peer | ICE candidate |
| `sync_request` | peer→peer | Request full/incremental graph sync |
| `sync_response` | peer→peer | Yjs state diff |
| `intent` | peer→peer | L8 collaboration intent (share/discuss/annotate/broadcast) |
| `provenance` | peer→peer | Provenance sub-graph sync |
| `presence` | broadcast | Peer identity + capabilities |
| `heartbeat` | peer→peer | Keepalive |
| `error` | peer→peer | Error signal |
| `disconnect` | peer→peer | Graceful teardown |

All messages include: `id`, `type`, `from`, `to`, `timestamp`, `signature` (optional), and typed `payload`.

### Peer Connection State Machine

```
disconnected → connecting → connected → syncing → synced → ready
                                                        → connected
                                  reconnecting ←──── disconnected
```

States: `disconnected`, `connecting`, `connected`, `syncing`, `synced`, `ready`, `reconnecting`, `disconnecting`, `failed`, `blocked`.

Transitions guard against invalid moves (e.g. `disconnected → syncing` raises an error).

## Data Flow

### 1. Discovery

```
Runtime A                          SignalingServer                   Runtime B
  │── presence({peerId, caps})─────►│                                  │
  │                                  │── presence({peerId, caps})─────►│
  │◄── peer_list([B]) ─────────────│◄── peer_list([A]) ───────────────│
```

- `DiscoveryService` registers with the signaling server on startup
- Capability advertisement is broadcast as a `presence` message
- `PeerDirectory` unifies local + remote peer views with filtered queries

### 2. Connection

```
Peer A                              Peer B
  │── offer ──────────────────────►│
  │◄── answer ─────────────────────│
  │── ice_candidate ──────────────►│
  │◄── ice_candidate ──────────────│
  │── heartbeat (periodic) ───────►│
  │◄── heartbeat (periodic) ───────│
```

- `PeerConnectionManager` manages the full WebRTC lifecycle per peer
- `DataChannelManager` opens 5 labeled channels per connection:
  - `sync` — CRDT state sync
  - `intent` — L8 collaboration intents
  - `provenance` — Provenance sub-graph sync
  - `control` — Heartbeat/keepalive
  - `stream` — (reserved) real-time streaming

### 3. Graph Synchronization

```
Connected peers
  │
  │  sync_request (full)
  │────────────────────────►
  │                         compute stateVector
  │◄──────────────────────── sync_response (encodeStateAsUpdate)
  │  apply update to Y.Doc
  │
  │  (local edit triggers Yjs update event)
  │────────────────────────► sync_response (incremental update)
  │
  │  origin-tagging prevents echo loops:
  │    Yjs transaction origin = own peerId
  │    received updates tagged with remote peerId → skip broadcast
```

- `FederatedGraph` wraps a `Y.Doc` with `Y.Map` for nodes and `Y.Array` for edges
- All sub-objects (context, spatial, attributes, relations) stored as JSON strings to avoid deep Yjs type nesting
- `SyncProtocol` manages per-peer sessions with full → incremental sync progression
- `ConflictResolver` supports LWW, intent priority, authority wins, and merge strategies
- `FederatedSnapshotEngine` maintains Hot/Warm/Cold tiered snapshots

### 4. Collaboration Intents (L8)

```
Handler A                          FederatedRuntime               Peer B
  │── execute(intent)──────────────►│                                  │
  │                                  │── message(intent)──────────────►│
  │                                  │                                  │── handler.execute()
  │                                  │◄── result ──────────────────────│
  │◄── result───────────────────────│                                  │
```

L8 tools (wrapped by `L8ToolRegistry`):
- **Share** (`share-handler.ts`) — Push entities/snapshots with permission
- **Discuss** (`discuss-handler.ts`) — Multi-peer annotation threads
- **Annotate** (`annotate-handler.ts`) — L8 annotations on shared entities
- **Broadcast** (`broadcast-handler.ts`) — Publish intent to N peers with TTL/scope

### 5. Cross-Runtime Provenance

```
Runtime A                           ProvenanceSync                  Runtime B
  │── record(dependency)────────────►│                                  │
  │                                  │── provenance message ──────────►│
  │                                  │                                  │── createAnchor()
  │                                  │                                  │── store in local chain
  │── causalWalk(anchor)────────────►│                                  │
  │◄── full chain ───────────────────│                                  │
```

- `ProvenanceBridge` syncs provenance sub-graphs between runtimes via `federation.provenance` messages
- `CrossRuntimeCausalWalker` follows `ProvenanceAnchor` records across runtimes
- `TrustMigration` verifies trust chains and chain approvals per-runtime policy

## Key Classes

| Class | File | Responsibility |
|-------|------|----------------|
| `FederatedRuntime` | `runtime/federated-runtime.ts` | Top-level orchestrator: state machine, init subsystems, dispatch incoming messages |
| `PeerConnectionManager` | `connection/index.ts` | WebRTC offer/answer/ICE lifecycle per peer |
| `DataChannelManager` | `connection/data-channel.ts` | 5 labeled channels, per-message routing, pending buffer |
| `SignalingServer` | `signaling/index.ts` | In-memory peer registry + message relay |
| `FederatedGraph` | `graph/federated-graph.ts` | Yjs CRDT wrapper, SemanticGraph ↔ Y.Map/Y.Array mapping |
| `SyncProtocol` | `graph/sync-protocol.ts` | Per-peer session state machine, full + incremental sync |
| `ConflictResolver` | `graph/conflict-resolver.ts` | Conflict strategy selection and resolution |
| `FederatedSnapshotEngine` | `graph/snapshot-engine.ts` | Tiered snapshot construction (Hot/Warm/Cold) |
| `DiscoveryService` | `discovery/discovery-service.ts` | Signaling registry + presence broadcast |
| `CapabilityAdvertisement` | `discovery/capability-advertisement.ts` | Local/remote capability tracking |
| `PeerDirectory` | `discovery/peer-directory.ts` | Unified peer view with filtered queries |
| `RemoteCapabilityBridge` | `discovery/remote-capability-bridge.ts` | Tool/role indexed remote capability registry |
| `L8ToolRegistry` | `collaboration/tool-registry.ts` | Wraps handlers as Tool-compatible objects |
| `MultiPeerMemory` | `collaboration/multi-peer-memory.ts` | Remote turn tracking, CognitiveReference resolution |
| `ProvenanceBridge` | `provenance-bridge/provenance-bridge.ts` | Cross-runtime provenance recording + sync |
| `CrossRuntimeCausalWalker` | `provenance-bridge/causal-walker.ts` | Follow anchors across runtime boundaries |
| `TrustMigration` | `provenance-bridge/trust-migration.ts` | Per-runtime trust policy and chain verification |

## Configuration

```typescript
interface FederationRuntimeConfig {
  maxPeers: number;             // Max concurrent peer connections (default: 10)
  syncThrottleMs: number;       // Throttle between sync broadcasts (default: 100)
  heartbeatIntervalMs: number;  // Heartbeat interval (default: 5000)
  connectionTimeoutMs: number;  // Connection timeout (default: 10000)
  trustLevel: string;           // Minimum trust for inbound intents (default: 'basic')
  iceServers: RTCIceServer[];   // STUN/TURN servers
  topology: 'star' | 'mesh';   // Peer topology (default: 'mesh')
}
```

`createDefaultConfig()` provides sensible defaults for local development.

## Integration with `@usir/runtime`

`createFederationIntegration()` in `packages/runtime/src/federation-bridge.ts` wires the federated runtime into the host runtime:

```typescript
const runtime = createRuntime(config);
const federation = createFederationIntegration(runtime);

// federation exposes:
federation.start();  // starts FederatedRuntime
federation.stop();   // graceful shutdown
federation.state;    // current FederationLifecycleState
federation.events;   // EventEmitter for lifecycle events
```

Integration effects:
1. Registers L8 tool handlers (`share`, `discuss`, `annotate`, `broadcast`) into the runtime's `ToolRegistry`
2. Connects peer connect/disconnect events to `AdapterCapabilityRegistry` (removes remote adapters on peer loss)
3. `FederationLifecycleEvent` system fires on state transitions, peer connection, graph sync, intent receipt, and errors

## Testing

- Framework: vitest (co-located `*.test.ts`)
- 10 test files, 62 tests
- In-memory signaling avoids WebRTC dependency in unit/integration tests
- Integration tests create two `FederatedRuntime` instances with direct signaling relay
- Run: `pnpm --filter @usir/federation test`

## Deployment

### Local Development

```bash
# Build all dependencies
pnpm build

# Run federation tests
pnpm --filter @usir/federation test

# Lint
pnpm --filter @usir/federation lint

# Typecheck
pnpm --filter @usir/federation typecheck
```

### Production Considerations

1. **Signaling Server** — Replace the in-memory `SignalingServer` with a WebSocket or HTTP signaling relay for multi-machine deployments. The `FederationTransport` interface supports this swap.

2. **STUN/TURN** — Configure ICE servers in `FederationRuntimeConfig.iceServers`. For browser runtimes, a TURN server is necessary for NAT traversal.

3. **Trust Policies** — Set `trustLevel` and implement custom `TrustMigration.verifyChain()` for your security model.

4. **Persistence** — `FederatedSnapshotEngine` warm/cold snapshots can be persisted to disk or a database for crash recovery.

5. **Multi-peer** — `maxPeers` controls connection count. For large topologies, use `topology: 'star'` to reduce mesh complexity.

## Lifecycle Events

```typescript
type FederationLifecycleEvent =
  | { type: 'state_change'; from: string; to: string }
  | { type: 'peer_connected'; peerId: string; trustLevel: string }
  | { type: 'peer_disconnected'; peerId: string }
  | { type: 'graph_synced'; peerId: string }
  | { type: 'intent_received'; intent: string; from: string }
  | { type: 'error'; code: string; message: string; peerId?: string };
```

Listen via `federation.events.on('state_change', handler)` or poll `federation.state`.
