# Part 5: L0.5 Provenance — The Layer Nobody Talks About

> *Act I — The Foundation | Part 5 of 14*
>
> **Previously:** [Part 4](./usir-part4-snapshot-engine.md) traced the Tiered Snapshot Engine — how USIR separates instantaneous cursor state (Hot, ≤16ms), visible context (Warm, ≤150ms), and full semantic graph (Cold, async) into independently updated tiers. The snapshot is how the runtime *reads* the world. This post is about how it *records* what happens to the world — and why that recording is a safety primitive, not a logging afterthought.

---

In most software systems, logging and mutation are separate concerns. The application changes state; separately, somewhere, something logs that the change happened. The log is secondary. It can be turned off. It can be incomplete. It can be wrong.

USIR makes a different bet: **provenance is not a log of what the system did — it is part of what the system is.** Every mutation to a `SemanticEntity` that passes through USIR's executor produces a `ProvenanceNode`. That node records not just what changed, but who authorized it, why, under what causal chain, and with a cryptographic hash of the state before and after. The provenance graph is the answer to questions that pure event logs cannot answer: *Why does this function have this signature? Was that refactor authorized by a human or decided unilaterally by an agent? If I roll back, what else will unravel?*

USIR calls this "L0.5" — positioned between L0 (Meta: confirm, cancel, undo) and L1 (Navigation). It sits below all user-facing intent layers because it is not a user feature. It is an infrastructure guarantee. You cannot build trustworthy agentic automation without it.

This post dissects the provenance design layer by layer: the protocol types in `packages/protocol/src/provenance/index.ts`, the runtime store in `packages/runtime/src/provenance/provenance-store.ts`, and the cross-runtime federation infrastructure in `packages/federation/src/provenance-bridge/`. We close with the critical enforcement problem that no amount of type safety can fully solve.

---

## The Philosophy: Why "Semantic Diff" Instead of "Text Diff"

Before diving into types, it is worth understanding why USIR defines its own diff format instead of just capturing git diffs or text deltas.

Consider a refactor that renames a function from `validateToken` to `verifyToken` and updates all call sites. A text diff faithfully records which lines changed. But it cannot answer:

- Was this rename caused by a user instruction ("rename this function") or an agent's autonomous decision ("I noticed naming inconsistency")?
- Was it authorized? Did the user explicitly approve, or did the agent act on a delegated permission that the user granted two hours ago?
- Which other mutations are causally downstream of this rename? If the user rejects it, what else needs to roll back?
- Was the entity's *semantic role* affected, or just its display name?

A text diff is a description of file content. A `SemanticDiff` is a description of *intent-level state change* at the entity and relation level. The two can look identical (same lines changed) while meaning entirely different things in terms of authorization and causality.

This is why `SemanticDiff` records `changedFields` with a `kind` discriminant — `'attribute'`, `'relation_added'`, `'relation_removed'`, `'spatial'`, `'audio'` — rather than line numbers. A rename is an `attribute` change to `displayName`. A new import statement is a `relation_added` change. Adding a function to a class is both an `attribute` change (the class entity's `attributes.methodCount`) and a `relation_added` edge from the class to the new function entity. The semantic diff captures structure; the text diff captures bytes.

---

## The Protocol: `ProvenanceNode`

The full schema lives in `packages/protocol/src/provenance/index.ts`. The header comment is the design document:

```typescript
/**
 * L0.5 Provenance Layer — the missing piece.
 *
 * Every mutation in USIR answers *what* changed and *which intent* caused it.
 * But it does not yet answer:
 *   - WHY did this change happen?
 *   - WHO/WHAT authorized it?
 *   - WHAT was the chain of reasoning?
 *   - Can I roll back the entire causal tree, not just one step?
 *
 * The USIR invariant: an entity state is meaningless without its provenance chain.
 */
```

The full `ProvenanceNode` interface:

```typescript
export interface ProvenanceNode {
  provenanceId: string;           // "provenance://<nodeId>"
  intentId: string;               // the intent that caused this
  intentSnapshot: BaseIntent;     // full intent state at time of execution
  actor: ProvenanceActor;         // who did it
  rationale: Rationale;           // why
  authorization: Authorization;   // permitted by what
  causalParents: string[];        // provenanceIds of upstream mutations
  timestamp: number;
  contentHashBefore: string;      // SHA-256 of entity state before
  contentHashAfter: string;       // SHA-256 of entity state after
  semanticDiff: SemanticDiff;     // field-level diff
  signature?: string;             // optional cryptographic non-repudiation
  runtimeId?: string;             // for cross-runtime provenance
  remoteProvenanceId?: string;    // id of corresponding node in remote runtime
  remoteRuntimeId?: string;       // the remote runtime's identifier
}
```

Nine required fields, three optional federation fields, one optional signature. Let's examine each discriminated union type in detail.

### `ProvenanceActor` — three kinds of cause

```typescript
export type ProvenanceActor =
  | { type: 'user'; id: string }
  | { type: 'agent'; id: string; parentDelegateIntentId: string; confidence: number }
  | { type: 'system'; id: string; reason: string };
```

The `'agent'` variant carries `parentDelegateIntentId` — the id of the delegation intent that granted this agent permission to act. This is the audit trail for agentic automation: you can always ask "what delegation authorized this agent?" and trace back to the human `DelegateIntent` at the root. The `confidence` field records the LLM's self-reported confidence at the time of execution. A `confidence: 0.6` agent mutation that turned out wrong is a very different audit finding from a `confidence: 0.99` one.

The `'system'` variant has a `reason` string for internally-generated mutations — things like automatic graph maintenance, index rebuilding, or federation sync operations that do not originate from user intent. These are the mutations you want to be able to filter *out* of the human-decision audit trail.

### `Authorization` — four states of permission

```typescript
export type Authorization =
  | { type: 'approved';  approvalIntentId: string; approverId: string; at: number }
  | { type: 'delegated'; delegateIntentId: string; allowedEntityIds?: string[]; constraints?: string[] }
  | { type: 'pending';   awaitingApprovalIntentId: string }
  | { type: 'rejected';  reason: string; at: number };
```

This is the trust model crystallized as a type. Every mutation in USIR is in one of these four authorization states:

`'approved'` means a human explicitly approved this specific action, recorded against an `approvalIntentId` with a `approverId` and timestamp. This is the gold standard — there is a named human who said yes, and when they said it.

`'delegated'` means the mutation falls within the scope of a previously granted delegation. The `delegateIntentId` points to the `DelegateIntent` that established the permission scope. `allowedEntityIds` optionally constrains the delegation to specific entities — a delegation that says "you may refactor functions in this file" but not "you may touch the configuration files." `constraints` is a free-form string array for policy conditions ("only during business hours", "never in production").

`'pending'` means the mutation was recorded but not yet executed — it is waiting for human review. The `awaitingApprovalIntentId` is the approval request that was surfaced to the user. This is how USIR implements the "checkpoint" in its A2U (Agent-to-USIR) trust protocol: high-risk actions land in `'pending'` state and only execute after the user responds to the approval waypoint.

`'rejected'` means a pending mutation was explicitly denied. The node stays in the provenance graph as a record of the *intent* to mutate, even though the mutation never happened. This is important: the provenance graph is not a log of what *was done* — it is a log of what was *attempted*. Rejected nodes are part of the audit trail.

### `Rationale` — four kinds of "why"

```typescript
export type Rationale =
  | { type: 'user-requested'; rawInput: string; interpretedIntent: string }
  | { type: 'delegated';      planStep: string; interpretedIntent: string }
  | { type: 'inferred';       rule: string; confidence: number }
  | { type: 'system';         reason: string };
```

`'user-requested'` carries the raw voice or text input (`"rename this function"`) and the LLM's interpretation (`"intent.manipulation.edit on function#authenticateUser"`). When the user later asks "why was this function renamed?", the runtime reads `rationale.rawInput` from the provenance node and can answer in the user's own words.

`'delegated'` is for agent-driven mutations within a plan. `planStep` is the step description from the `ExecutionPlan` — the LLM's prose description of what this step was trying to achieve.

`'inferred'` is the most concerning variant. It means the mutation happened because the runtime *inferred* it should, based on a rule, without an explicit user request or delegation. `confidence: number` records how confident the inference was. USIR does not currently produce `'inferred'` mutations anywhere in its implemented adapter code — the field exists as a design affordance for future proactive-computing features. But its presence in the type system is a warning sign: if an inference-based mutation appears in a provenance audit and the user doesn't recognize why it happened, `rationale.rule` should explain the triggering condition. If it doesn't, the provenance has failed its purpose.

### `SemanticDiff` — field-level change records

```typescript
export interface SemanticDiff {
  entityId: string;
  entityBefore: Partial<SemanticEntity>;
  entityAfter: Partial<SemanticEntity>;
  changedFields: Array<{
    field: string;
    before: unknown;
    after: unknown;
    kind: 'attribute' | 'relation_added' | 'relation_removed' | 'spatial' | 'audio';
  }>;
}
```

`entityBefore` and `entityAfter` are `Partial<SemanticEntity>` — full entity snapshots, but typed as partial to allow recording mutations where the entity did not previously exist (creation) or no longer exists (deletion). `changedFields` is the structured diff, one entry per changed field with a semantic `kind` tag.

The `kind` field is what separates this from a generic object diff. `'relation_added'` and `'relation_removed'` tell the causal walker that this mutation affected the graph topology — new edges appeared or disappeared. `'spatial'` tells the XR runtime that this mutation moved something in 3D space. `'audio'` tells the voice disambiguation layer that the entity's phonetic fingerprint changed. These tags let different subsystems efficiently subscribe to the provenance graph for mutations relevant to them without scanning all `changedFields`.

---

## The Protocol Graph: `ProvenanceGraph`

Individual `ProvenanceNode` objects are organized into a `ProvenanceGraph`:

```typescript
export interface ProvenanceGraph {
  nodes: Map<string, ProvenanceNode>;
  byEntity: Map<string, string[]>;   // entityId → [provenanceId, ...]
  byIntent: Map<string, string>;     // intentId → provenanceId (1:1)
  byActor: Map<string, string[]>;    // actorId → [provenanceId, ...]
  capturedAt: number;
}
```

Three secondary indices, mirroring the `SemanticGraph`'s `byRole` / `bySource` pattern from Part 3. `byEntity` answers "what is the full history of this entity?" `byIntent` answers "which provenance node does this intent correspond to?" — critical for detecting whether an intent has already been executed before re-routing it. `byActor` answers "what has this agent (or user, or system) done?" — the starting point for any audit of agent behavior.

The `recordProvenance` function maintains all three indices and also indexes the *targets* of relation changes, not just the primary entity:

```typescript
export function recordProvenance(graph: ProvenanceGraph, node: ProvenanceNode): void {
  graph.nodes.set(node.provenanceId, node);
  const entityIds = new Set<string>();
  for (const change of node.semanticDiff.changedFields) {
    if (change.kind === 'relation_added' || change.kind === 'relation_removed') {
      const targetId = (change.after ?? change.before) as string;
      if (typeof targetId === 'string') entityIds.add(targetId);
    }
  }
  entityIds.add(node.semanticDiff.entityId);
  for (const entityId of entityIds) {
    // index both the source entity and the relation target
    if (!graph.byEntity.has(entityId)) graph.byEntity.set(entityId, []);
    graph.byEntity.get(entityId)!.push(node.provenanceId);
  }
  // ... byIntent and byActor indexing
}
```

This double-indexing means that if a provenance node records a new `calls` relation from `authenticateUser` to `validateToken`, the node appears in *both* `byEntity.get('authenticateUser')` and `byEntity.get('validateToken')`. The history of the callee implicitly includes every event that created or destroyed a call edge pointing at it. This is what allows the provenance system to answer "what changed the callers of `validateToken`?" without scanning the entire graph.

### `walkCausalChain` — the answer to "why?"

The most powerful operation on the provenance graph is causal chain walking:

```typescript
export function walkCausalChain(
  graph: ProvenanceGraph,
  startNodeId: string,
): ProvenanceNode[] {
  const visited = new Set<string>();
  const chain: ProvenanceNode[] = [];
  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (!node) continue;
    chain.push(node);
    for (const parentId of node.causalParents) {
      if (!visited.has(parentId)) queue.push(parentId);
    }
  }
  return chain.reverse(); // genesis first
}
```

Starting from a provenance node, BFS walks up `causalParents` until the queue is empty. The result is the full causal tree — every decision that led to this state — ordered genesis-first. The `ProvenanceStore.explainHistory(entityId)` method calls this starting from the *latest* provenance node for a given entity:

```typescript
public explainHistory(entityId: string): ProvenanceNode[] {
  const provenanceIds = this.graph.byEntity.get(entityId) ?? [];
  if (provenanceIds.length === 0) return [];
  const latest = provenanceIds[provenanceIds.length - 1]!;
  return walkCausalChain(this.graph, latest);
}
```

The answer to "why does this function look like this?" is a chain of `ProvenanceNode` objects, each with a `rationale` explaining the human instruction or delegation that drove it, and an `authorization` documenting who permitted it.

### `hashEntity` — the cryptographic backbone

```typescript
export async function hashEntity(entity: SemanticEntity): Promise<string> {
  const json = JSON.stringify(entity, Object.keys(entity).sort());
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const data = new TextEncoder().encode(json);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(json).digest('hex');
}
```

`hashEntity` is environment-aware: `SubtleCrypto` in the browser and webview, `node:crypto` in the extension host. The key detail is `Object.keys(entity).sort()` as the second argument to `JSON.stringify` — this ensures the key order in the JSON representation is deterministic regardless of insertion order. Without it, `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` (the same object with different insertion histories) would produce different hashes. The sort makes hashing a function of the entity's *content*, not its construction order.

`contentHashBefore` and `contentHashAfter` on the `ProvenanceNode` make state changes verifiable. Given a provenance node and the current entity state, you can recompute the hash and confirm whether the recorded `contentHashAfter` matches. If they differ, the entity was mutated outside the provenance system — a silent escape from the audit trail. This is the tamper detection story.

The optional `signature` field on `ProvenanceNode` is the stronger story: a cryptographic signature of the serialized node, created by the actor's private key. `verifyChain` in `TrustMigration` checks `policy.requireSignature` and rejects chains that contain unsigned nodes when the policy demands signatures. The current implementation does not populate `signature` anywhere — it is a forward-declared slot for a PKI integration that does not yet exist.

---

## The Runtime Store: `ProvenanceStore`

The protocol types define the schema. `packages/runtime/src/provenance/provenance-store.ts` is the runtime implementation — an in-memory `ProvenanceGraph` with a persistence backend, query methods, and approval/rejection operations.

The class comment is honest: *"In-memory implementation for the MVP. Real implementation would back this with a durable store (SQLite, RocksDB, or a graph database)."* The current implementation uses a `JsonFileStorage` default, with a `Storage` interface that accepts either a JSON file backend or SQLite (`SqliteStorage`). The dual backend is defined in `@usir/runtime`'s `persist.ts`.

### `record()` — the central method

```typescript
public async record(args: {
  intent: BaseIntent;
  actor: ProvenanceActor;
  rationale: Rationale;
  authorization: Authorization;
  entityBefore: SemanticEntity;
  entityAfter: SemanticEntity;
  causalParents: string[];
}): Promise<ProvenanceNode> {
  const [hashBefore, hashAfter] = await Promise.all([
    hashEntity(args.entityBefore),
    hashEntity(args.entityAfter),
  ]);
  const semanticDiff = this.computeDiff(args.entityBefore, args.entityAfter);
  const node: ProvenanceNode = {
    provenanceId: `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intentId: args.intent.intentId,
    intentSnapshot: args.intent,
    actor: args.actor,
    rationale: args.rationale,
    authorization: args.authorization,
    causalParents: args.causalParents,
    timestamp: Date.now(),
    contentHashBefore: hashBefore,
    contentHashAfter: hashAfter,
    semanticDiff,
  };
  recordProvenance(this.graph, node);
  return node;
}
```

`record()` is async because `hashEntity` is async (SubtleCrypto's `digest` is Promise-based). Both hashes are computed in parallel with `Promise.all`. The `provenanceId` is a timestamp + random suffix — not a UUID, but functionally unique at the rate nodes are generated. A production implementation would use a proper UUID v7 (time-ordered) for sortability.

The `computeDiff` method produces the `SemanticDiff` by iterating all fields across both entity snapshots:

```typescript
private computeDiff(before: SemanticEntity, after: SemanticEntity): SemanticDiff {
  const changedFields: SemanticDiff['changedFields'] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const beforeVal = (before as any)[key];
    const afterVal = (after as any)[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      let kind: SemanticDiff['changedFields'][number]['kind'] = 'attribute';
      if (key === 'relations') kind = 'relation_added'; // simplified; should diff sets
      else if (key === 'spatial') kind = 'spatial';
      else if (key === 'audioFingerprint') kind = 'audio';
      changedFields.push({ field: key, before: beforeVal, after: afterVal, kind });
    }
  }
  return { entityId: after.id, entityBefore: before, entityAfter: after, changedFields };
}
```

The comment in the code — `// simplified; should diff sets` — is an honest self-critique. The current implementation treats the entire `relations` array as a single changed field when any relation changes. It does not diff the *set* of relations to identify which specific edges were added or removed. This means a node that adds a new `calls` edge produces `{ field: 'relations', before: [/* old relations */], after: [/* new relations */], kind: 'relation_added' }` — but the `'relation_removed'` kind is never actually produced. An auditor looking at a node with `kind: 'relation_added'` still has to diff the `before`/`after` arrays manually to find which edge was added.

### `listPending()` and `approve()` — the human-in-the-loop interface

```typescript
public listPending(): ProvenanceNode[] {
  return Array.from(this.graph.nodes.values()).filter(
    (n) => n.authorization.type === 'pending',
  );
}

public approve(provenanceId: string, approvalIntentId: string, approverId: string): ProvenanceNode | null {
  const node = this.graph.nodes.get(provenanceId);
  if (!node || node.authorization.type !== 'pending') return null;
  node.authorization = { type: 'approved', approvalIntentId, approverId, at: Date.now() };
  return node;
}
```

`listPending()` is the queue of mutations waiting for human review. The `A2UDispatcher` (the Agent-to-USIR interface, covered in Part 8) creates nodes with `authorization: { type: 'pending' }` for high-trust-tier operations and surfaces them to the user as approval waypoints. When the user approves, `provenanceStore.approve()` transitions the node's authorization state and the executor proceeds.

Note that `approve()` mutates the node in place: `node.authorization = { type: 'approved', ... }`. This is a violation of the immutability principle that governs `SemanticEntity` objects (which are updated by re-inserting into the graph). The `ProvenanceNode` is being treated as mutable here — the same object that was inserted with `'pending'` authorization is updated to `'approved'` without creating a new node or bumping the graph's `capturedAt`. This is pragmatically fine for the approval workflow (you don't want a *new* provenance node to record the approval of the old one — that would require infinite regress), but it does mean the `contentHashBefore`/`contentHashAfter` hashes on the node no longer match the node's actual content after the state transition.

---

## Where `record()` Is Called: The Execution Boundary

The provenance system's power depends entirely on one architectural guarantee: **every mutation passes through `provenanceStore.record()` before taking effect.** In practice, this means `record()` is called in exactly one place in the current implementation: `A2UDispatcher.dispatch()`.

```typescript
public async dispatch(envelope: A2UEnvelope): Promise<DispatchResult> {
  const trust = this.trustClassifier.classify(envelope.intent.intent, envelope.agentState.confidence);

  // 1. Always record to provenance — before routing
  await this.provenanceStore.record({
    intent: envelope.intent.intent,
    actor: {
      type: 'agent',
      id: envelope.agentState.workerId,
      parentDelegateIntentId: envelope.agentState.parentDelegateIntentId,
      confidence: envelope.agentState.confidence,
    },
    rationale: {
      type: 'delegated',
      planStep: envelope.agentState.planProgress.currentPhase,
      interpretedIntent: envelope.intent.intent.rawInstruction ?? '',
    },
    authorization: trust.requiresApproval
      ? { type: 'pending', awaitingApprovalIntentId: envelope.intent.intent.intentId }
      : { type: 'delegated', delegateIntentId: envelope.agentState.parentDelegateIntentId, ... },
    entityBefore: { id: '', role: 'unknown', ... },  // <-- placeholder
    entityAfter:  { id: '', role: 'unknown', ... },  // <-- placeholder
    causalParents: [envelope.agentState.parentDelegateIntentId],
  });

  // 2. Route based on trust tier
  if (!trust.requiresApproval) return this.executeImmediate(envelope);
  ...
}
```

The comment says *"Always record to provenance"* — it fires unconditionally before any routing decision. Whether the action gets approved, queued, or rejected, there is a provenance node for it.

There is a critical gap visible in the code: `entityBefore` and `entityAfter` are placeholder objects with `id: ''` and `role: 'unknown'`. The `A2UDispatcher` records that *an intent was dispatched* — but it does not record what the entity looked like before and after the mutation. The actual entity diff is therefore empty: `computeDiff` produces no `changedFields` because two identical empty objects differ on nothing. The hashes are useless as tamper detection because they hash empty entities.

This is not a design error — it is an implementation gap. The correct behavior would be: before calling the executor tool, snapshot the target entity from the semantic graph; after the tool executes, snapshot the entity again; record both in the provenance node. The current code does not have access to the semantic graph at the `A2UDispatcher` level, so it cannot perform this snapshot. The fix requires threading the `SnapshotEngine` (or the `SemanticGraph` directly) through to the dispatcher, so it can read the target entity's state before and after each tool call.

---

## The Federation Layer: Provenance Across Runtime Boundaries

Single-runtime provenance is tractable. Cross-runtime provenance is where the design gets genuinely novel.

When two USIR runtimes are federated — say, a VS Code instance on Alice's machine and a browser-based USIR runtime on Bob's — and Alice's agent delegates a task that causes Bob's runtime to mutate an entity on Bob's side, whose provenance graph owns that mutation? How does Alice's runtime know what Bob's agent did? How does Bob's runtime verify that Alice's delegation was legitimate?

The federation layer's answer is the `ProvenanceBridge`, `CrossRuntimeCausalWalker`, and `TrustMigration` trio in `packages/federation/src/provenance-bridge/`.

### `ProvenanceBridge` — the sync layer

`ProvenanceBridge` maintains a local copy of the `ProvenanceGraph` and synchronizes it to peers every 10 seconds:

```typescript
const PROVENANCE_SYNC_INTERVAL = 10000;

export class ProvenanceBridge {
  recordLocal(node: ProvenanceNode): void {
    const enriched = { ...node, runtimeId: this.runtimeId };
    recordProvenance(this.localGraph, enriched);
    this.state.pendingExports.push(node.provenanceId);
  }

  handleRemoteProvenance(envelope: { senderId: string; payload: ProvenancePayload }): void {
    for (const remoteNode of payload.nodes) {
      const localNode: ProvenanceNode = {
        provenanceId: `remote:${remoteNode.provenanceId}`,  // namespace with 'remote:' prefix
        ...
        runtimeId: senderId,
        remoteProvenanceId: remoteNode.provenanceId,
        remoteRuntimeId: senderId,
      };
      recordProvenance(this.localGraph, localNode);
      const anchor = createAnchor({ anchorType: 'import', ... });
      this.state.anchors.set(anchor.anchorId, anchor);
    }
  }
}
```

Remote nodes are imported with a `remote:` prefix on their `provenanceId`. This prevents namespace collisions between local and remote provenance ids. The `ProvenanceAnchor` records the mapping: `localProvenanceId: "remote:abc123"` ↔ `remoteProvenanceId: "abc123"` on `remoteRuntimeId: "runtime-bob"`. Anchors are the stitching that lets the `CrossRuntimeCausalWalker` follow causal chains across runtime boundaries.

The payload format is deliberately minimal — it transmits `provenanceId`, `intentId`, `entityId`, `actorId`, `timestamp`, `contentHashBefore`, `contentHashAfter`, `causalParents`, but not `entityBefore` / `entityAfter` in full. The full entity snapshots are not serialized across the wire. This is a bandwidth trade-off: remote runtimes get the audit trail (what changed, who did it, when) but not the full content diff. To reconstruct the full diff, you would need to query the originating runtime.

### `CrossRuntimeCausalWalker` — following the chain across borders

```typescript
export class CrossRuntimeCausalWalker {
  walk(provenanceId: string, maxDepth: number = 100): CrossRuntimeCausalChain {
    const queue: Array<{ id: string; depth: number }> = [{ id: provenanceId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      // ... walk causalParents normally
      for (const parentId of node.causalParents) {
        queue.push({ id: parentId, depth: depth + 1 });
      }
      // CROSS-RUNTIME JUMP: check if this local node has an anchor to a remote node
      const anchor = this.findAnchorForProvenance(id);
      if (anchor) {
        const remoteId = `remote:${anchor.remoteProvenanceId}`;
        queue.push({ id: remoteId, depth: depth + 1 }); // follow the cross-runtime edge
      }
    }
    return {
      nodes: chain.reverse(),
      totalHops: chain.length,
      spansRuntimes: runtimesInvolved.size > 1,  // flag: did this cross a boundary?
      runtimesInvolved: Array.from(runtimesInvolved),
    };
  }
}
```

The standard BFS traversal is augmented with one additional step per node: check whether this provenance node has an `anchor` pointing to a remote runtime. If it does, add the remote node's id (with the `remote:` prefix) to the queue and keep walking. The traversal naturally crosses runtime boundaries wherever anchors exist.

The `CrossRuntimeCausalChain` result includes `spansRuntimes: boolean` and `runtimesInvolved: string[]`. These are the federation audit signals: if an entity mutation ultimately traces back to an agent on a remote runtime, `spansRuntimes` is `true` and `runtimesInvolved` lists both runtimes. A security auditor can use this to identify mutations that crossed trust boundaries.

### `TrustMigration` — verifying imported causal chains

When a mutation from Runtime B arrives at Runtime A, Runtime A needs to decide: should I accept this causal chain as legitimate? `TrustMigration` answers this question.

```typescript
requestMigration(request: TrustMigrationRequest): TrustMigrationResult {
  const policy = this.policies.get(request.sourceRuntimeId) ?? this.getDefaultPolicy();
  const node = this.localGraph.nodes.get(request.provenanceId);
  const chain = this.buildChain(node, policy);
  let verified = this.verifyChain(chain, policy);

  if (verified && policy.minimumTrustScore !== undefined) {
    const score = this.resolveTrustScore(request.sourceRuntimeId);
    if (score !== null && score < policy.minimumTrustScore) {
      verified = false;
    }
  }
  if (verified) this.trustedRuntimes.add(request.sourceRuntimeId);

  return { success: verified, verified, chain, trustScore, error };
}
```

`TrustPolicy` specifies the verification rules per source runtime:

```typescript
export interface TrustPolicy {
  requireSignature: boolean;          // must every node in the chain be signed?
  maxChainDepth: number;              // how far back is the chain allowed to go?
  allowedActorTypes: Array<'user' | 'agent' | 'system'>;
  requireApprovalForDelegation: boolean;  // must agent actions be explicitly approved?
  minimumTrustScore?: number;         // optional numeric trust floor (0-100)
}
```

`verifyChain` walks every node in the chain and checks each against the policy — actor type allowed, signature present if required, agent actions approved if `requireApprovalForDelegation` is true. If any node fails, the entire chain fails.

`buildChain` and `verifyChain` do not currently verify the cryptographic hashes (`contentHashBefore`/`contentHashAfter`) against the actual entity states on the receiving runtime. This is the most significant gap in the trust verification: hash checking would confirm that the claimed entity state transitions actually happened, not just that the provenance records are internally consistent. Without hash verification, a malicious runtime could fabricate a plausible-looking provenance chain with correct structural form but incorrect content.

The `minimumTrustScore` mechanism is a numeric trust floor — if Runtime B has a trust score below the threshold, its provenance chain is rejected regardless of structural validity. The `runtimeTrustScores` map and `scoreProvider` interface leave open how trust scores are assigned (web of trust, manual configuration, reputation system), but neither mechanism is implemented.

---

## Architecture Diagram: Provenance Flow

```
User speaks: "rename authenticateUser to verifyUser"
                            │
                            ▼
                     handleInstruction()
                            │
                            ▼
               llmRouter.route() → ExecutionPlan
                            │
                            ▼
              a2uDispatcher.dispatch(envelope)
                            │
            ┌───────────────┴─────────────────────┐
            │                                      │
            ▼                                      ▼
  provenanceStore.record()              trustClassifier.classify()
    actor: { type:'user', ... }            → { requiresApproval: false }
    rationale: { type:'user-requested',   
      rawInput: 'rename auth...' }          │
    authorization: { type:'delegated' }    ▼
    entityBefore: { *** PLACEHOLDER *** }  executor.execute()
    entityAfter:  { *** PLACEHOLDER *** }     │ tool: 'vscode.rename'
    causalParents: [...]                       │ args: { from:'authenticateUser',
            │                                  │         to:'verifyUser' }
            │                                  │
            ▼                                  ▼
  ProvenanceGraph.nodes                  VS Code API
  ─────────────────────                  (actual rename)
  prov-1703...-abc123                         │
    intentId: 'int-abc'                        │
    rationale.rawInput: 'rename auth...'       │
    authorization.type: 'delegated'            │
    contentHashBefore: 'xxxxxx' (of empty!)   │
    contentHashAfter:  'yyyyyy' (of empty!)   │
    semanticDiff.changedFields: []  ← gap     │
            │                                  │
            └────────────────┬─────────────────┘
                             │
                ProvenanceBridge.recordLocal()
                  + pendingExports.push(id)
                             │
              every 10s: syncPendingProvenance()
                  → sends to federated peers
                             │
                             ▼
               Remote runtime receives payload
               handleRemoteProvenance()
                 → provenanceId: 'remote:prov-1703...'
                 → anchor: local ↔ remote mapping
                             │
                CrossRuntimeCausalWalker.walk()
                  → follows causalParents locally
                  → jumps via anchor to remote node
                  → runtimesInvolved: ['runtime-alice', 'runtime-bob']
```

---

## The Critical Take: The Enforcement Problem

The provenance design is architecturally correct. The enforcement story is not.

The `ProvenanceStore.record()` comment in `A2UDispatcher.dispatch()` says *"always record to provenance."* And within the `A2UDispatcher` boundary, it does. But `A2UDispatcher` is only one entry point into the executor. The `TopologicalExecutor` can also be called directly — the VS Code extension's `handleInstruction` calls `executor.execute()` after routing, and that path does **not** go through `A2UDispatcher` for user-initiated intents:

```typescript
// In extension.ts handleInstruction():
const plan = await llmRouter.route({ rawInstruction, snapshot, memory });
// ...
const result = await a2uDispatcher.dispatch(envelope);  // agent path
// OR:
// executor.execute(plan)  // direct path for user intents (not shown,
//                         // but this is where provenance is missing)
```

More broadly: the VS Code adapter's `onDidChangeTextDocument` listener updates `snapshotEngine.cold.addEntity(entity)` — an `addEntity` call on the semantic graph that is entirely outside the provenance system. Files saved directly by the user (not through USIR's tool registry) mutate the graph without producing any provenance node. The same is true of every browser DOM mutation not captured by the adapter, every IoT sensor update, every LSP symbol change.

The provenance system covers agent-dispatched mutations. It does not cover the world changing under USIR's feet through paths that bypass the tool registry. This is not a solvable problem in the general case — you cannot intercept every VS Code API call or every DOM mutation. But it means the provenance graph's completeness guarantee is conditional: *"complete for mutations routed through USIR's executor."* Real-world usage will produce entities whose actual state does not match their provenance-recorded state, because direct edits silently advance the entity without updating `contentHashAfter` on the relevant provenance node.

The hash tamper-detection story is also significantly weakened by the entity placeholder problem. The `contentHashBefore` and `contentHashAfter` in `A2UDispatcher`'s calls hash *empty entities*, not the actual entities being mutated. This means the hashes are stable (consistent with each other) but meaningless as tamper detectors. A mutation on `authenticateUser` produces a provenance node with the same `contentHashBefore` and `contentHashAfter` as a mutation on any other entity — both hash empty objects.

These are solvable problems: thread `SemanticGraph` access through `A2UDispatcher`, snapshot the target entity before and after each tool call, and store the real hashes. They are listed in `IMPLEMENTATION.md` as known gaps. They are worth naming here because the current `ProvenanceStore.record()` call has the *shape* of correct provenance — all the right fields, all the right types — while delivering less than the design promises on the most critical integrity guarantees.

What the implementation *does* deliver reliably: the full authorization and rationale record. Every dispatched agent action has a `ProvenanceActor` with a `parentDelegateIntentId`, a `Rationale` with the plan step description, and an `Authorization` state that correctly reflects whether the action was `'approved'`, `'delegated'`, or `'pending'`. The *who*, *why*, and *was-it-authorized* questions are answered. The *what-exactly-changed* question is not.

---

## Summary

L0.5 Provenance is USIR's answer to a question most interaction runtimes never ask: *can I tell you exactly why every entity in the system has its current state, who authorized each change, and what the full causal chain looks like — including changes that originated in a different runtime on a different machine?*

The design says yes. The `ProvenanceNode` schema is careful and complete: four `ProvenanceActor` variants, four `Authorization` states, four `Rationale` kinds, a semantic diff with field-level `kind` tags, SHA-256 content hashes, an optional cryptographic signature, and three federation fields for cross-runtime causal chaining. The `ProvenanceGraph` maintains three secondary indices for efficient querying. `walkCausalChain` traverses up `causalParents` to reconstruct the full decision tree. The `CrossRuntimeCausalWalker` extends this traversal across WebRTC-connected USIR peers via `ProvenanceAnchor` mappings. `TrustMigration` verifies imported causal chains against per-runtime `TrustPolicy` rules.

The implementation delivers the authorization and rationale tracking faithfully. It does not yet deliver full entity snapshots (hashing empty placeholders instead of real entities), does not yet diff relations as sets, and does not yet extend provenance recording to user-initiated mutations that bypass the A2U dispatcher. The `signature` field exists but is never populated; hash verification in `TrustMigration` is absent.

These are known gaps, not design flaws. The design is ahead of the implementation. For a pre-alpha system intended to demonstrate that provenance-as-infrastructure is possible, that order is correct. The schema is right. The gaps are engineering tasks.

Next in Part 6: Interaction Memory — how USIR resolves "that file", "the previous one", and "the thing we discussed earlier" into concrete entity ids using a ring buffer, four resolver strategies, and a disambiguation protocol that surfaces to voice, quick-pick, and HTML panels through the same `InteractionWaypoint` interface.

---

*USIR Deep-Dive Blog Series — Act I: The Foundation*
*← [Part 4: The Tiered Snapshot Engine](./usir-part4-snapshot-engine.md) | [Part 6: Interaction Memory](./usir-part6-interaction-memory.md) →*

*Code references: `packages/protocol/src/provenance/index.ts`, `packages/runtime/src/provenance/provenance-store.ts`, `packages/federation/src/provenance-bridge/provenance-bridge.ts`, `packages/federation/src/provenance-bridge/causal-walker.ts`, `packages/federation/src/provenance-bridge/trust-migration.ts`, `apps/vscode-extension/src/extension.ts`*
