# The Architecture of Intent, Part 5: The Ledger of 'Why' (L0.5 Provenance)

*Engineering the Post-GUI Era — Part 5 of 14*

---

Allowing an autonomous AI agent to modify your filesystem while you sleep requires a level of trust that current computing paradigms cannot support. 

If you wake up to find your database schema rewritten, your current tools are woefully inadequate for figuring out what happened. `git blame` will tell you *what* lines changed and *when*, attributed to a generic "Agent" commit. Traditional application undo/redo stacks are linear, memory-bound, and completely blind to context. 

Neither system can answer the most important question in agentic workflows: **Why?**

Why did the agent choose DynamoDB types? What was its confidence level? Did it hallucinate this requirement, or was it fulfilling a delegated step from a master plan? Did I implicitly authorize this when I approved a different checkpoint three days ago?

In the Universal Semantic Interaction Runtime (USIR), state mutations are considered meaningless without their causal history. To solve this, USIR introduces a foundational sub-layer to the Universal Intent Ontology: **L0.5 Provenance**. 

It is not a log. It is an append-only, cryptographically hashed, Directed Acyclic Graph (DAG) of causality.

### The Anatomy of a Provenance Node

Every time the USIR Topological Executor successfully runs a command that mutates state, it is strictly forbidden from proceeding until it commits a `ProvenanceNode` to the `ProvenanceStore`. 

Defined in `packages/protocol/src/provenance/index.ts`, the schema forces the runtime to explicitly bind the mutation to human (or agentic) reasoning:

```typescript
export interface ProvenanceNode {
  /** Unique provenance id (URN: "provenance://<nodeId>") */
  provenanceId: string;
  /** The intent that caused this mutation */
  intentId: string;
  
  /** Who/what performed the mutation (e.g., 'user', 'agent', 'system') */
  actor: ProvenanceActor;
  
  /** Why this mutation happened */
  rationale: Rationale;
  
  /** The authorization chain that permitted it */
  authorization: Authorization;
  
  /** Causal parents — other provenance nodes that led to this one */
  causalParents: string[];
  
  /** Hash of the target entity's state before and after */
  contentHashBefore: string;
  contentHashAfter: string;
  
  /** The actual diff (semantic, not text) */
  semanticDiff: SemanticDiff;
}
```

This data structure replaces the linear "Undo" stack with a web of accountability. 

The `Rationale` field categorizes the exact cognitive origin of the action: was it `user-requested` (explicit voice command), `delegated` (a step in an agent's execution plan), or `inferred` (proactive computing, which we cover later)?

The `Authorization` field tracks the permission gate: was it `approved` via a human clicking a UI button, `delegated` via a previously granted sandbox token, or `rejected`?

### Semantic Diffs vs. Text Diffs

Look closely at the bottom of the schema: `contentHashBefore`, `contentHashAfter`, and `semanticDiff`. 

Current LLM coding tools rely heavily on text diffs. Text diffs are dangerous because they entangle semantics with formatting. If an agent renames a variable from `timeout` to `retryTimeout`, and the IDE's Prettier formatter kicks in and breaks the line into multiple lines, a text diff registers a massive file rewrite. 

USIR does not diff text. Because the application exposes a `SemanticEntity` (as explored in Part 3), USIR diffs the semantic graph. 

When a mutation occurs, the `ProvenanceStore` records a `SemanticDiff`:
`{ field: 'displayName', before: 'timeout', after: 'retryTimeout', kind: 'attribute' }`

Simultaneously, it generates a stable SHA-256 hash of the `SemanticEntity` JSON object before and after the change. 

```typescript
// From packages/runtime/src/provenance/provenance-store.ts
public async record(args: RecordArgs): Promise<ProvenanceNode> {
  const [hashBefore, hashAfter] = await Promise.all([
    hashEntity(args.entityBefore),
    hashEntity(args.entityAfter),
  ]);
  
  const semanticDiff = this.computeDiff(args.entityBefore, args.entityAfter);
  
  const node: ProvenanceNode = {
    provenanceId: `prov-${Date.now()}-${randomString()}`,
    intentId: args.intent.intentId,
    // ... maps actor, rationale, authorization
    causalParents: args.causalParents,
    contentHashBefore: hashBefore,
    contentHashAfter: hashAfter,
    semanticDiff,
  };
  
  recordProvenance(this.graph, node);
  return node;
}
```

By hashing semantic entities rather than text files, USIR guarantees that an inverse operation (a rollback) is deterministically safe. If the hash matches, the rollback will succeed. 

### Walking the Causal Chain

Because every `ProvenanceNode` tracks its `causalParents`, the history of an entity forms a DAG. 

If you look at a deeply refactored database schema and ask USIR, *"Why is this here?"*, the runtime issues an L0.5 `ExplainMutationIntent`. 

The `CrossRuntimeCausalWalker` begins at the current state of the entity and walks backward through the `causalParents` array. It translates the DAG into a human-readable explanation: *"This entity was modified by `Agent-Worker-2` because you issued a `DelegateIntent` to 'Migrate to DynamoDB' on Tuesday. The agent's confidence was 0.92, and it proceeded under the 'delegated' authorization policy."*

When combined with USIR's WebRTC federation layer (which we will tear apart in Part 10), this causal walker can even track provenance across physical machines, hopping from your local runtime to a peer's runtime to verify the origin of a shared document edit.

### The Critical Take: The `vim` Problem

The USIR provenance graph is mathematically and theoretically airtight. If every state mutation flows through the `TopologicalExecutor`, causality is perfectly preserved. 

But operating systems are globally mutable state machines. This is USIR's "Vim Problem."

Imagine USIR’s agent modifies a configuration file. The `ProvenanceStore` records the `contentHashBefore` (State A) and `contentHashAfter` (State B). 

Ten minutes later, the user opens a terminal, types `vim config.ts`, and manually changes a value. The file is now at State C. 

The user then returns to the USIR interface and says, *"Undo the agent's last change."* 

USIR will attempt to execute a rollback from State B to State A. However, the file is currently at State C. Because the manual `vim` edit occurred out-of-band—bypassing the USIR adapter layer—the `contentHash` will fail validation. The provenance chain is silently broken. 

Without a kernel-level file-system filter driver to intercept and block all non-USIR mutations (an extraordinarily heavy-handed OS architecture), cryptographic provenance hashes are incredibly fragile. In real-world developer environments where humans use third-party tools, CLI scripts, and manual editors alongside their AI agents, the causal DAG will frequently orphan its branches, requiring complex, fuzzy reconciliation to recover.

### What's Next

Provenance grounds actions in causality. It allows the runtime to understand *why* something happened in the past. But how does the runtime understand what the user means *right now*? 

In **Part 6**, we will look at **Interaction Memory**. We will explore why natural human language is full of pronouns, and how USIR uses Temporal, Conversational, and 3D Spatial resolvers to ensure that when you say *"Make that bigger"*, the LLM never has to guess what "that" is.

---
*Next:* **[Part 6: Grounding the LLM (Interaction Memory)]**