# The Semantic Horizon, Part 5: The Federated Semantic Web — L8 Collaboration Intents

Over the course of this architecture series, we have pushed the Universal Semantic Interaction Runtime (USIR) to the absolute edge of individual computing. We conquered legacy GUI software with Zero-Shot VLMs, merged physical IoT devices into our digital graph, enabled proactive computing via physiological telemetry, and delegated async tasks to autonomous agents.

We have built the ultimate Personal Cloud OS.

But human work is inherently social. And currently, if two humans want to collaborate digitally, they must surrender to a centralized monolith.

If you want to design together, you both must log into Figma. If you want to write together, you both use Google Docs. Collaboration today requires forcing multiple users into the exact same proprietary UI paradigm, hosted on a centralized server that owns your data. "Screen sharing" over Zoom is the ultimate admission of failure—we are literally streaming compressed video pixels because our underlying applications have no shared semantic language.

In this final post, we will shatter the SaaS monopoly. We will explore the **L8 Collaboration Intents**, introduce peer-to-peer Multiplayer Snapshots via CRDTs, and unveil the holy grail of post-GUI computing: **Asymmetric Modality Collaboration**.

## 1. The L8 Collaboration Intents

In a traditional application, collaboration features (comments, cursors, sharing) are hardcoded into the frontend. In USIR, collaboration is just another layer in the Universal Intent Ontology.

We introduce the **L8 Collaboration Intents** into `packages/protocol/src/intents/index.ts`:

```typescript
// --- L8: Collaboration Intents ---

export interface ShareIntent extends BaseIntent {
  type: 'intent.collaboration.share';
  target: SemanticEntity | SemanticEntity[]; 
  collaboratorId: string; // USIR Identity (e.g., decentralized DID)
  permissions: ('read' | 'comment' | 'edit' | 'delegate')[];
  expiresAt?: number;
}

export interface DiscussIntent extends BaseIntent {
  type: 'intent.collaboration.discuss';
  target: SemanticEntity;
  message: string;
  /** Asymmetric: recipient may render via different modality */
  preferredModality?: 'voice' | 'text' | 'spatial';
}

export interface AnnotateIntent extends BaseIntent {
  type: 'intent.collaboration.annotate';
  target: SemanticEntity;
  annotation: string;
  anchor?: { spatial?: unknown; temporal?: unknown };
}

export interface BroadcastIntent extends BaseIntent {
  type: 'intent.collaboration.broadcast';
  annotationId: string;
  recipients: string[];
  modality?: 'voice' | 'text' | 'spatial';
}
```

Notice the careful decomposition (refining the first review's critique of overloaded `DiscussIntent`): sharing is separate from discussing, and discussing is separate from annotating. The receiving peer's runtime handles modality translation independently.

## 2. Multiplayer Snapshots & CRDTs

How do two runtimes synchronize their graphs? They don't use a centralized database. They use **Conflict-free Replicated Data Types (CRDTs)** over a peer-to-peer WebRTC connection.

When Alice's runtime shares an entity with Bob's runtime, the entity is converted into a CRDT (e.g., a `Yjs` document for the attributes, a custom CRDT for the graph edges).

```typescript
// In packages/protocol/src/federation/crdt.ts
import * as Y from 'yjs';

export class FederatedEntity {
  private ydoc: Y.Doc;
  private attributes: Y.Map<unknown>;
  private relations: Y.Array<unknown>;

  constructor(initialEntity: SemanticEntity) {
    this.ydoc = new Y.Doc();
    this.attributes = this.ydoc.getMap('attributes');
    this.relations = this.ydoc.getArray('relations');
    
    this.attributes.set('displayName', initialEntity.displayName);
    this.attributes.set('role', initialEntity.role);
  }

  // Expose the Yjs state vector for WebRTC sync
  public getUpdate(remoteStateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, remoteStateVector);
  }
}
```

This allows Alice and Bob to edit the same semantic entity simultaneously—even offline—and merge their changes deterministically when they reconnect. There is no "server" that owns the truth; the truth is the eventual consensus of the peers.

## 3. Asymmetric Modality Collaboration: The Killer Feature

This is the architectural property that makes USIR incompatible with SaaS collaboration tools, and therefore the property that lets it kill them.

**Scenario:**
Alice is at her desk with a full XR setup, multiple monitors, and a keyboard.
Bob is driving his car, hands-free, with only his car's audio system and a smartwatch.

Alice points at a complex function in her code and says to her glasses, *"Share this with Bob and tell him to look at the race condition on line 42."*

The runtime:
1. Creates a `ShareIntent` targeting the function, granting Bob read+comment permissions.
2. Creates an `AnnotateIntent` on line 42 with the message "race condition."
3. Creates a `BroadcastIntent` to send the annotation to Bob, with `modality: 'voice'`.

Alice's runtime synchronizes the CRDT for the function to Bob's runtime over a low-bandwidth WebRTC data channel.

Bob's runtime receives the `BroadcastIntent` and the CRDT update. It projects the shared function and the annotation into a **voice-only Waypoint**:

> *"Alice shared a function with you. She flagged a race condition on line 42. She says: 'There's a race condition here, the lock is released before the write commits.' Alice wants your input."*

Bob speaks: *"Tell her I'll fix it when I get home. Add a TODO."*

Bob's runtime:
1. Creates a `DiscussIntent` replying to Alice.
2. Creates an `EditIntent` adding a TODO comment to line 42 (after running it through the Trust Classifier and confirming Bob has edit permission via the `ShareIntent`).

Alice's XR glasses show a floating spatial panel: Bob's voice message transcribed, the TODO comment appearing on line 42 in real-time, and a small avatar indicating Bob is en route.

They are collaborating on the *same semantic entity* (the function), using *completely different modalities*, with *no shared server*, and *no shared application*.

## 4. Provenance Across Sovereign Runtimes

The L0.5 Provenance graph from earlier is extended to be federated. When Bob edits the function, the provenance node is created in Bob's local graph, and a hash of that node is included in the CRDT update sent to Alice.

When Alice receives the update, her runtime appends a *causal reference* to Bob's provenance node in her own local graph. If a conflict ever occurs (e.g., both Alice and Bob edit the same line), the provenance graph provides the exact history of who did what, when, and with what authorization.

## 5. The Death of SaaS

When this federation layer is fully realized, the economic model of software flips. Why would you pay for "Figma" when your runtime can invoke a `vector-graphics-capability` from a provider, share the resulting design as a CRDT with your team, and render it on whichever device each teammate owns?

The "Application" was a 40-year workaround. It bundled:
- A rendering engine (now replaced by your device)
- A data store (now replaced by your semantic graph)
- A collaboration model (now replaced by federated CRDTs)
- A user interface (now replaced by USIR Waypoints)

The only thing an "app" provided was *behavior*—the actual logic of how to do something. In USIR, that behavior is a **Capability**. And capabilities are discovered, invoked, and paid for on an open market, not locked inside a SaaS subscription.

## Conclusion: The Semantic Horizon

This concludes the Semantic Horizon series. We have journeyed from a single user speaking to a single application, to a federated network of sovereign runtimes collaborating across asymmetric modalities and physical realities.

The 8-Layer Intent Ontology is complete. The runtime is deterministic. The memory is persistent. The execution is topologically sound. The provenance is cryptographically verifiable. The collaboration is peer-to-peer.

USIR is not a "voice interface project" or an "AI agent framework." It is the operating system for the post-application era. It is the protocol layer that abstracts interaction, just as TCP/IP abstracted networking and HTML abstracted documents.

The next decade of computing will not be defined by who builds the best "app." It will be defined by who builds the best **semantic runtime**.

---

**Return to:** [Master Specification](../MASTER-SPEC.md) | [12-Month Roadmap](../ROADMAP.md)
