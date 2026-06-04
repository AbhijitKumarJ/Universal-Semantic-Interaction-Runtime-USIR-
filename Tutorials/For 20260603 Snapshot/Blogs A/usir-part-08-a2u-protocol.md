# Part 8: The A2U Protocol — Keeping Humans in Control of Agents They're Not Watching

> **Series:** Decoding the Post-GUI Runtime — Act II: The Machine in Motion  
> **Previous:** [Part 7 — The LLM Router and Topological Executor: Plans That Actually Execute](#)  
> **Next:** [Part 9 — The Audio Pipeline: Voice as a First-Class Citizen](#)

---

Every agentic system eventually reaches the same question: *when does the agent ask, and when does it just do?*

Most systems answer it badly. Some answer by making everything require approval — an agent that asks before every action is a more annoying version of a wizard. Others answer by making everything automatic — an agent that never asks is a process you can't supervise and can't trust. The right answer involves a model of *action categories*: some things are safe to do silently, some things should be checkpointed, and some things must be blocked until a human says yes. No confidence score should be able to override the last category.

USIR's answer to this is the A2U (Agent-to-USIR) protocol. It is a 3-tier trust gate with four urgency levels and a `DelegateIntent` that makes agent scope an explicit parameter rather than an assumption. This post argues it is one of the most important and underappreciated parts of the entire runtime — not because the implementation is especially complex, but because *getting the design right here matters more than almost any other architectural decision in an agentic system*.

---

## The Problem: Agents at L7 Without a Leash

To understand why A2U exists, look at the intent ontology layer where it operates: L7 Delegation. At L1–L3 (navigation, focus, information), the agent is doing exactly what a sophisticated search engine does — reading, locating, explaining. No state changes. No risk. At L4–L6 (manipulation, execution, creation), the agent is editing code, running tests, creating files — consequential actions, but bounded and reversible. At L7, the user has said "just handle it" — delegating a *goal* rather than a specific action.

A delegated goal like "refactor the authentication module to use JWT" decomposes into an unknown number of sub-steps. The agent will decide, on the fly, what those steps are. Some will be edits (reversible). Some will be file deletions (not reversible). Some will be test runs (external side effects). The user said "handle it" — they did not sign off on each individual mutation.

This is the leash problem. Without a protocol that structures the boundary between autonomous agent action and human oversight, "handle it" becomes an unbounded permission. The A2U protocol is that leash.

---

## The DelegateIntent: Scope as a First-Class Parameter

The user's side of the delegation starts with `DelegateIntent`, defined in `packages/protocol/src/intents/`:

```typescript
// packages/protocol/src/intents/index.ts

export interface DelegateIntent extends BaseIntent {
  type: 'intent.delegation.delegate';
  target: SemanticEntity | CognitiveReference;
  /** What the agent is trying to accomplish */
  objective: string;
  /** Constraints the agent must respect — expressed as natural language rules */
  constraints?: string[];
  /** Confidence threshold below which the agent must checkpoint (default: 0.85) */
  confidenceThreshold?: number;
  /** Which entity IDs the agent is permitted to touch */
  sandboxEntityIds?: string[];
  /** Max execution time before forced checkpoint (ms) */
  maxExecutionMs?: number;
}
```

Every field matters. `objective` is the goal: `"Refactor all JWT handling into a dedicated AuthService class"`. `constraints` are the guard rails the user expresses in natural language: `["Don't delete any tests", "Don't modify files outside /src/auth"]`. `confidenceThreshold` is the per-user confidence floor — below this, the agent must surface a checkpoint even for Tier 2 (reversible) actions. `sandboxEntityIds` is the explicit allowlist of entity IDs the agent may touch. `maxExecutionMs` is a hard time limit — a delegation that's been running for 10 minutes without completing has probably gone off-track.

The `CheckpointIntent` is the response side — how the human approves or rejects mid-plan:

```typescript
export interface CheckpointIntent extends BaseIntent {
  type: 'intent.delegation.checkpoint';
  stepIndex: number;
  decision: 'approve' | 'reject' | 'discuss';
  rationale?: string;
}
```

`discuss` is the most interesting option here. It's not a binary approve/reject — it opens a conversational channel where the user can ask the agent to explain the proposed action, suggest a modification, or change the scope. The agent receives the discussion as a new intent, processes it, and either revises the plan or re-surfaces the checkpoint with the updated proposal. This is what makes the A2U protocol a *conversation* rather than an interlock.

---

## The TrustClassifier: The Three-Tier Gate

The `TrustClassifier` is the first thing the dispatcher calls. It takes a single `BaseIntent` and an optional agent confidence score, and returns a `TrustTier`:

```typescript
// packages/runtime/src/a2u/trust-classifier.ts

export interface TrustTier {
  tier: 1 | 2 | 3;
  requiresApproval: boolean;
  logToProvenance: boolean;
  reversible: boolean;
}

const CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE = 0.85;

export class TrustClassifier {
  classify(intent: BaseIntent, agentConfidence?: number): TrustTier {
    const conf = agentConfidence ?? 1.0;
    switch (intent.type) {

      // ── Tier 1: Read-only ──────────────────────────────────────────────────
      case 'intent.information.explain':
      case 'intent.information.summarize':
      case 'intent.information.compare':
      case 'intent.information.search':
      case 'intent.navigation.locate':
      case 'intent.attention.focus':
      case 'intent.attention.highlight':
        return { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };

      // ── Tier 2: Reversible mutations ──────────────────────────────────────
      case 'intent.manipulation.edit':
      case 'intent.manipulation.move':
      case 'intent.manipulation.create':
        return {
          tier: 2,
          requiresApproval: conf < CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE,
          logToProvenance: true,
          reversible: true,
        };

      // ── Tier 3: Irreversible or high-impact ───────────────────────────────
      case 'intent.manipulation.delete':
      case 'intent.execution.run':
      case 'intent.execution.schedule':
      case 'intent.collaboration.share':
      case 'intent.collaboration.broadcast':
        return { tier: 3, requiresApproval: true, logToProvenance: true, reversible: false };

      default:
        // Unknown intent type: safe default is Tier 2 with approval required
        return { tier: 2, requiresApproval: true, logToProvenance: true, reversible: true };
    }
  }

  /**
   * Classify a delegate plan's aggregate trust requirement.
   * Returns the MAXIMUM tier across all sub-intents.
   */
  classifyDelegatePlan(intents: BaseIntent[]): TrustTier {
    let max: TrustTier = { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };
    for (const intent of intents) {
      const tier = this.classify(intent);
      if (tier.tier > max.tier) max = tier;
    }
    return max;
  }
}
```

Three things are worth examining carefully.

**The confidence threshold for Tier 2.** `CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE = 0.85` is a hardcoded constant, not a configuration option. The `DelegateIntent` has a `confidenceThreshold` field that could, in principle, override this per-delegation — a user who trusts a specific agent for a specific task could set a lower threshold. But the classifier currently ignores the `DelegateIntent` context entirely; it uses the constant for all Tier 2 decisions. The protocol is designed for per-user tuning; the implementation isn't there yet.

**Tier 3 is unconditional.** There is no confidence score that makes a `delete`, `run`, or `broadcast` intent auto-approve. The `requiresApproval: true` for Tier 3 intents is not gated on `conf` — it's always true, regardless of what `agentConfidence` is passed. This is the correct design. A 0.99-confidence delete is still a delete. The agent's certainty about what to delete is completely separate from the human's decision about whether to delete it.

**The default is Tier 2 with approval required.** Any intent type not explicitly listed in the switch falls to `tier: 2, requiresApproval: true`. This is a safe-fail default: unknown intent types get treated as reversible mutations that require human review. An agent that emits a novel intent type doesn't get a free pass — it gets blocked until a human sees what it's trying to do.

**`classifyDelegatePlan` takes the maximum.** When the dispatcher is classifying a full `DelegateIntent` plan upfront (not individual steps), it uses max-tier semantics. A plan that contains one `intent.information.explain` and one `intent.manipulation.delete` is a Tier 3 plan — the delete elevates the whole thing. This prevents an agent from hiding a dangerous step in a mostly-harmless plan and hoping the plan-level classification gets a free pass.

The test suite is explicit about the invariants:

```typescript
// packages/runtime/src/a2u/trust-classifier.test.ts

it('classifies read-only intents as Tier 1', () => {
  const result = classifier.classify(intent('intent.information.explain'));
  expect(result.tier).toBe(1);
  expect(result.requiresApproval).toBe(false);
});

it('Tier 2 requires approval below confidence threshold', () => {
  const high = classifier.classify(intent('intent.manipulation.edit'), 0.95);
  const low  = classifier.classify(intent('intent.manipulation.edit'), 0.5);
  expect(high.requiresApproval).toBe(false);  // 0.95 > 0.85 → auto-approve
  expect(low.requiresApproval).toBe(true);    // 0.5 < 0.85 → checkpoint
});

it('classifies irreversible actions as Tier 3', () => {
  const result = classifier.classify(intent('intent.manipulation.delete'));
  expect(result.tier).toBe(3);
  expect(result.requiresApproval).toBe(true);
  expect(result.reversible).toBe(false);
});

it('classifyDelegatePlan returns max tier', () => {
  const plan = [
    intent('intent.information.explain'),   // Tier 1
    intent('intent.manipulation.delete'),   // Tier 3
  ];
  const result = classifier.classifyDelegatePlan(plan);
  expect(result.tier).toBe(3);  // Max wins
});
```

---

## The A2UEnvelope: The Agent's Message to the Runtime

When an agent working under a `DelegateIntent` wants to take an action, it doesn't call a tool directly. It constructs an `A2UEnvelope` and hands it to the `A2UDispatcher`:

```typescript
// packages/runtime/src/a2u/dispatcher.ts

export interface A2UEnvelope {
  intent: IntentEnvelope;
  agentState: {
    workerId: string;
    parentDelegateIntentId: string;
    planProgress: {
      totalSteps: number;
      completedSteps: number;
      currentPhase: string;
      estimatedRemaining: number;
    };
    sandboxEntityIds: string[];
    confidence: number;
    uncertainty?: string;
  };
  surfacingReason:
    | { type: 'checkpoint';          description: string }
    | { type: 'uncertainty';         question: string; options?: string[] }
    | { type: 'constraint-violation'; constraint: string; proposed: string }
    | { type: 'completion';          summary: string }
    | { type: 'failure';             reason: string; recoverable: boolean };
  urgency: Urgency;   // 'background' | 'checkpoint' | 'blocker'
  defaultBehaviour: {
    action: 'proceed' | 'pause' | 'abort';
    timeoutMs: number;
    proceedCondition?: string;
  };
}
```

The `A2UEnvelope` is the richest data structure in the runtime. It carries everything the dispatcher needs to make a trust decision, everything the user needs to understand what the agent is proposing, and everything the provenance store needs to build a causal chain.

`agentState.sandboxEntityIds` is the runtime enforcement of the scope promised in `DelegateIntent.sandboxEntityIds`. The agent must include the entity IDs it considers in scope for this specific envelope. If an envelope proposes acting on an entity ID not in the sandbox, the dispatcher should reject it before the classifier even runs — a scope violation caught before trust tier evaluation. (This pre-classification sandbox check is architecturally implied but not yet explicitly implemented in the dispatcher code; it's a clear gap.)

`surfacingReason` is the five-variant union that drives human-facing communication. Each variant is meaningfully different:

| Reason type | When the agent uses it | What the human sees |
|---|---|---|
| `checkpoint` | Planned pause in a multi-step delegation | Diff + Approve/Reject/Discuss |
| `uncertainty` | Agent genuinely doesn't know which path to take | Question with options |
| `constraint-violation` | Agent computed that its next action would violate a user constraint | The rule being broken + proposed action |
| `completion` | The delegated goal is fully achieved | Summary of what was done |
| `failure` | The agent cannot make progress | Reason + whether recovery is possible |

`constraint-violation` is the most important of the five. It's the mechanism by which the agent's natural-language constraints from `DelegateIntent.constraints` become enforceable at runtime. If the user said "Don't modify files outside /src/auth" and the agent's plan step would touch `/src/utils/logger.ts`, the agent surfaces a `constraint-violation` envelope before executing — not after. The human sees the rule, the proposed action, and can choose to override the constraint, reject the step, or abandon the delegation.

`defaultBehaviour` is the fallback for when the human doesn't respond. `timeoutMs` specifies how long the dispatcher waits. `action` specifies what happens when the timeout expires: `'proceed'` (continue without the human's input — appropriate for low-risk checkpoint completions), `'pause'` (halt execution and queue the envelope for later review), or `'abort'` (terminate the delegation). The `proceedCondition` field is a natural-language description of when proceeding without human input is safe — written by the agent, for the dispatcher to evaluate.

---

## The Dispatcher: Routing by Trust and Urgency

The `A2UDispatcher.dispatch()` method is the decision engine. It combines the `TrustClassifier`'s verdict with the envelope's `urgency` to determine one of four outcomes:

```typescript
// packages/runtime/src/a2u/dispatcher.ts

export class A2UDispatcher {
  constructor(
    private trustClassifier: TrustClassifier,
    private provenanceStore: ProvenanceStore,
    private executor: TopologicalExecutor,
  ) {}

  public async dispatch(envelope: A2UEnvelope): Promise<DispatchResult> {
    const trust = this.trustClassifier.classify(
      envelope.intent.intent,
      envelope.agentState.confidence
    );

    // 1. ALWAYS record to provenance — even auto-approved actions are logged
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
        : {
            type: 'delegated',
            delegateIntentId: envelope.agentState.parentDelegateIntentId,
            allowedEntityIds: envelope.agentState.sandboxEntityIds,
          },
      causalParents: [envelope.agentState.parentDelegateIntentId],
      // ...
    });

    // 2. Route based on trust tier + urgency
    if (!trust.requiresApproval) {
      return this.executeImmediate(envelope);
    }

    if (envelope.urgency === 'background') {
      return this.queueForReview(envelope);
    }

    if (envelope.urgency === 'checkpoint') {
      return this.surfaceCheckpoint(envelope);
    }

    if (envelope.urgency === 'blocker') {
      return this.interruptUser(envelope);
    }

    return { status: 'queued' };
  }
```

The dispatch logic, when written as a decision table:

```
trust.requiresApproval == false  →  executeImmediate (Tier 1, or Tier 2 with confidence ≥ 0.85)
trust.requiresApproval == true
  AND urgency == 'background'    →  queueForReview   (batch for next idle moment)
  AND urgency == 'checkpoint'    →  surfaceCheckpoint (show diff, await approval)
  AND urgency == 'blocker'       →  interruptUser    (immediate modal interrupt)
```

The first observation: provenance recording is unconditional. It happens before the routing decision, not after it. Every agent action — auto-approved or blocked — is in the `ProvenanceStore` with a timestamp, confidence score, and authorization state (`pending` if approval is required, `delegated` if auto-approved). This means the audit trail is complete regardless of what the human does. Even if they never see a checkpoint, every auto-approved Tier 1 action is logged with its causal link to the parent `DelegateIntent`.

The `executeImmediate` path wraps the intent into a single-step plan and passes it directly to the `TopologicalExecutor`:

```typescript
private async executeImmediate(envelope: A2UEnvelope): Promise<DispatchResult> {
  const result = await this.executor.execute({
    planId: `plan-${envelope.intent.intent.intentId}`,
    rawInstruction: envelope.intent.intent.rawInstruction ?? '',
    steps: [{
      stepId:     envelope.intent.intent.intentId,
      tool:       envelope.intent.intent.type,
      args:       envelope.intent.args ?? {},
      dependsOn:  envelope.intent.dependsOn ?? [],
      optional:   envelope.intent.optional ?? false,
      confidence: envelope.agentState.confidence,
    }],
    ambiguities:        [],
    confidence:         envelope.agentState.confidence,
    detectedIntentType: envelope.intent.intent.type,
    createdAt:          Date.now(),
    trustTier:          1,
  });
  return { status: 'executed', result };
}
```

The `trustTier: 1` in the plan passed to the executor is significant: it hardcodes the plan's tier as read-only regardless of what the underlying intent type is. This is correct — by the time a plan reaches `executeImmediate`, the `TrustClassifier` has already confirmed that approval is not required. The executor doesn't need to re-evaluate; it just runs the step.

---

## The Checkpoint Waypoint: Three Modalities, One Object

When `surfaceCheckpoint()` is called, it constructs a checkpoint `InteractionWaypoint`:

```typescript
private buildCheckpointWaypoint(envelope: A2UEnvelope): InteractionWaypoint {
  const phase = envelope.agentState.planProgress.currentPhase;
  return {
    id: `checkpoint-${envelope.intent.intent.intentId}`,
    context: {
      state: 'agent-checkpoint',
      objective: `Review: ${phase}`,
    },
    presentations: {
      display: {
        layout: 'diff_review',
        prompt: `Agent wants approval: ${phase}`,
        primaryAction:   { label: 'Approve',  action: 'approve'  },
        secondaryAction: { label: 'Reject',   action: 'reject'   },
        tertiaryAction:  { label: 'Discuss',  action: 'discuss'  },
      },
      audio: {
        tts: `Checkpoint. ${phase}. ${this.surfacingReasonDescription(envelope)}. Approve, reject, or discuss?`,
      },
      haptic: {
        pattern: 'notification_double',
        timing: 'immediate',
      },
    },
    expectedInputs: {
      voice: {
        intents: [
          { utterances: ['approve', 'yes', 'proceed'], intentType: 'approve'  },
          { utterances: ['reject',  'no',  'undo'],    intentType: 'reject'   },
          { utterances: ['discuss', 'explain', 'why'], intentType: 'discuss'  },
        ],
      },
    },
    fallback: {
      channels: [{ channel: 'email', body: `Agent needs approval: ${phase}` }],
      timeoutMs: envelope.defaultBehaviour.timeoutMs,
      onExhaustion: 'queue',
    },
  };
}
```

The checkpoint waypoint is modality-complete by design. The same approval decision can be made via:

- **Screen** — VS Code HTML panel with a `diff_review` layout: the semantic diff of the proposed mutation, three buttons (Approve / Reject / Discuss), and a countdown timer.
- **Voice** — TTS prompt read aloud on earbuds or smart speaker: `"Checkpoint. Refactoring AuthService into JWT module. Agent wants to delete 47 lines in session.ts. Approve, reject, or discuss?"` Voice utterances `"yes"` / `"no"` / `"why"` map directly to actions.
- **Haptic** — `notification_double` pattern fires on a connected wearable simultaneously with the voice prompt.
- **Email fallback** — if the timeout elapses with no response, an email is sent. On exhaustion, the envelope is queued (not auto-proceeded, not auto-aborted).

The `fallback.onExhaustion: 'queue'` behavior on timeout is deliberate and conservative. The alternative — auto-proceeding on timeout — would defeat the purpose of the checkpoint for users who were momentarily unavailable. Queuing means the delegation pauses; the user resumes it when they return to their device.

---

## The Blocker Waypoint: When the Agent Cannot Proceed

The blocker waypoint is for `uncertainty` surfacing reasons — when the agent genuinely cannot make a decision without human input:

```typescript
private buildBlockerWaypoint(envelope: A2UEnvelope): InteractionWaypoint {
  const reason = envelope.surfacingReason;
  const question = reason.type === 'uncertainty'
    ? reason.question
    : 'Agent is blocked and needs your input';
  const options = reason.type === 'uncertainty' && reason.options
    ? reason.options
    : [];

  return {
    id: `blocker-${envelope.intent.intent.intentId}`,
    context: { state: 'agent-blocker', objective: 'Resolve agent blocker' },
    presentations: {
      display: {
        layout: 'modal',
        prompt: question,
        options: options.map((o, i) => ({ id: `opt-${i}`, label: o })),
      },
      audio: { tts: `Blocker. ${question}` },
      haptic: { pattern: 'attention_double', timing: 'immediate' },
    },
    expectedInputs: {
      voice: {
        intents: options.map((o, i) => ({
          utterances: [o.toLowerCase()],
          intentType: `opt-${i}`,
        })),
      },
    },
    fallback: {
      channels: [{ channel: 'voice_call', spokenSummary: question }],
      timeoutMs: 0,           // No timeout — blockers wait indefinitely
      onExhaustion: 'queue',
    },
  };
}
```

The blocker differs from the checkpoint in two important ways. First, the layout is `'modal'` rather than `'diff_review'` — there's no semantic diff to show because no mutation has been proposed yet. The agent is asking a question, not requesting approval for an action. Second, `timeoutMs: 0` — blockers wait indefinitely. A checkpoint represents a proposed action that can be auto-queued on timeout; a blocker represents a genuine decision the agent cannot make unilaterally. Proceeding without an answer isn't an option.

The fallback channel for blockers is `voice_call` rather than email — the urgency tier is higher. An agent that is completely blocked is more time-sensitive than one awaiting approval for a reversible action.

---

## The Full Dispatch Flow: End-to-End

Putting it together, the sequence for a delegated agent performing an irreversible action:

```
DelegateIntent fires:
  objective: "Remove all deprecated API endpoints"
  constraints: ["Don't touch auth endpoints"]
  sandboxEntityIds: ["file:///src/api/v1/", "file:///src/api/v2/"]
  confidenceThreshold: 0.9
  maxExecutionMs: 300000
         │
         ▼
Agent discovers:
  - 12 deprecated endpoints in /src/api/v1/
  - 3 of them are auth-related
  - Removing the auth endpoints would violate constraints[]
         │
         ▼
Agent constructs A2UEnvelope:
  intent: {type: 'intent.manipulation.delete', target: 'file:///src/api/v1/users-deprecated.ts'}
  agentState: {
    workerId: 'agent-a1b2',
    parentDelegateIntentId: 'delegate-xyz',
    planProgress: {completedSteps: 9, totalSteps: 12, currentPhase: 'Removing deprecated user endpoints'},
    sandboxEntityIds: ['file:///src/api/v1/', ...],
    confidence: 0.88
  }
  surfacingReason: {type: 'checkpoint', description: 'About to delete users-deprecated.ts (auth-adjacent)'}
  urgency: 'checkpoint'
  defaultBehaviour: {action: 'pause', timeoutMs: 120000}
         │
         ▼
A2UDispatcher.dispatch(envelope):
  1. TrustClassifier.classify('intent.manipulation.delete', 0.88)
     → {tier: 3, requiresApproval: true, reversible: false}
  2. ProvenanceStore.record(...)  ← logged BEFORE routing, authorization: 'pending'
  3. urgency === 'checkpoint' → surfaceCheckpoint(envelope)
         │
         ▼
buildCheckpointWaypoint(envelope):
  → InteractionWaypoint {
      layout: 'diff_review',
      prompt: 'About to delete users-deprecated.ts (auth-adjacent)',
      primaryAction: 'Approve',
      secondaryAction: 'Reject',
      tertiaryAction: 'Discuss',
      audio: { tts: 'Checkpoint. Removing deprecated user endpoints...' }
      fallback: { timeoutMs: 120000, onExhaustion: 'queue' }
    }
         │
         ▼
Human response: "Discuss"
         │
         ▼
CheckpointIntent { decision: 'discuss', stepIndex: 9 }
         │
         ▼
Agent explains → user approves → ProvenanceStore updates authorization to 'approved'
         │
         ▼
executeImmediate(envelope) → TopologicalExecutor.execute(single-step plan)
```

Every step in this sequence is auditable. The provenance node for `users-deprecated.ts`'s deletion carries the full causal chain: the `DelegateIntent` that authorized the delegation, the checkpoint that gated the specific deletion, the `CheckpointIntent` that carried the human approval, and the `workerId` of the agent that executed it.

---

## The VS Code Extension: Where the Checkpoint UI Lives

In the VS Code extension (`apps/vscode-extension/src/extension.ts`), the `A2UDispatcher` is initialized as one of the core subsystems:

```typescript
// apps/vscode-extension/src/extension.ts (activation sequence)

const trustClassifier = new TrustClassifier();
a2uDispatcher = new A2UDispatcher(
  trustClassifier,
  provenanceStore,
  executor,
);
```

However, examining `handleInstruction()` — the function that handles voice commands — reveals the gap between the A2U architecture and the current implementation:

```typescript
async function handleInstruction(rawInstruction: string) {
  // ... FusedIntent, memory push, LLM route ...

  // 4. Handle ambiguities
  if (plan.ambiguities.length > 0) {
    await handleAmbiguities(plan);
    return;
  }

  // 5. Execute  ← goes directly to the executor, bypassing A2UDispatcher
  const result = await executor.execute(plan);
  // ...
}
```

The `A2UDispatcher` is initialized but `handleInstruction` calls `executor.execute()` directly, bypassing the trust gate entirely. For user-initiated commands (the voice pipeline → LLM router → executor flow), the A2U check is not being applied. This means a user saying "delete this file" over voice would execute immediately without hitting the Tier 3 gate.

The A2U protocol is correctly wired for the *agent* path — when an autonomous agent running under a `DelegateIntent` constructs an `A2UEnvelope` and calls `a2uDispatcher.dispatch()`. But the *user* path — voice command → LLM plan → execution — does not go through the dispatcher. The trust tier classification done by the LLM router (discussed in Part 7) produces a `trustTier` on the `ExecutionPlan`, but nothing in `handleInstruction` checks that tier before calling `executor.execute()`.

The plan's `trustTier` is the hook for closing this gap. A complete implementation would look like:

```typescript
// What handleInstruction should do:
async function handleInstruction(rawInstruction: string) {
  // ... FusedIntent, memory, LLM route ...

  if (plan.ambiguities.length > 0) {
    await handleAmbiguities(plan);
    return;
  }

  // Gate on trust tier BEFORE execution
  if (plan.trustTier === 3) {
    const approved = await requestApproval(plan);  // Show diff panel, await user
    if (!approved) return;
  } else if (plan.trustTier === 2 && plan.confidence < 0.85) {
    const approved = await requestApproval(plan);  // Checkpoint on low confidence
    if (!approved) return;
  }

  const result = await executor.execute(plan);
  // ...
}
```

This gap matters in practice. The A2U checkpoint waypoint — with its `diff_review` layout, Approve/Reject/Discuss buttons, and countdown timer — is designed and specified. The `InteractionWaypoint` structure supports it. The `A2UDispatcher` is wired and ready. The VS Code extension just doesn't route user commands through it yet.

---

## The sandboxEntityIds Constraint: Right Idea, Hard Precondition

The `sandboxEntityIds` field in both `DelegateIntent` and `A2UEnvelope.agentState` is the protocol's answer to agent containment. The idea: when you delegate a task, you specify exactly which entities the agent may touch. Any attempt to act outside that list is a scope violation — the agent must surface a `constraint-violation` envelope and halt.

This is the right design. Explicit, declarative scope is far more auditable than implicit restrictions expressed in natural language. "Only touch files in /src/auth" is a soft constraint that an agent might misinterpret. `sandboxEntityIds: ['file:///src/auth/jwt.ts', 'file:///src/auth/session.ts', ...]` is an enforcement-ready allowlist.

But it rests on a precondition that the blog series plan correctly identifies: the entity graph must be richly mapped. `sandboxEntityIds` only constrains the entities the runtime *knows about*. In the VS Code adapter, where the LSP provides full semantic graph coverage, this works well — every file, function, and symbol has a stable entity ID. In a browser adapter working on a production web app, coverage depends on how well the DOM adapter has mapped the page. For legacy applications where the zero-shot VLM adapter is the only coverage mechanism, entity IDs may be sparse, unstable (JIT-compiled per-page-load), or missing entirely.

An agent delegated to "update the account settings form" in a well-mapped VS Code project will have clear entity boundaries. An agent delegated to "fill in the registration form" in an arbitrary web app has entity IDs that may change between page navigations. The `sandboxEntityIds` list computed at delegation time may be stale by the time the agent acts.

Until USIR has stable, persistent entity IDs across adapter types — which requires the embeddings-based entity fingerprinting that the semantic memory resolver also needs — `sandboxEntityIds` enforcement works best in VS Code and should be treated as advisory in browser and zero-shot contexts.

---

## Critical Take: What A2U Gets Right, and What It Needs

**What it gets unambiguously right:**

The three-tier model is sound. The mapping of intent types to tiers is correct — read-only operations really are categorically different from irreversible mutations, and no confidence score should make a delete auto-proceed. The `classifyDelegatePlan` max-tier semantics prevents the "bury the delete in a mostly-read-only plan" attack. The unconditional provenance logging ensures the audit trail is complete even for auto-approved actions.

The `surfacingReason` union is thoughtful. Most agentic systems surface only one kind of interrupt — an approval request. USIR's five-variant union — checkpoint, uncertainty, constraint-violation, completion, failure — gives the agent vocabulary to be precise about *why* it's interrupting the user. A `constraint-violation` with the rule written out is infinitely more useful than a generic "agent needs approval."

The modality-complete waypoint design is ambitious in the right direction. A checkpoint that works the same way over voice, on-screen, via haptic, and via email fallback is a checkpoint that works when the user is away from their screen — which is exactly when delegated agents are running.

**What is incomplete:**

The `handleInstruction` bypass is the most critical gap. User-initiated voice commands do not go through the A2U gate. The infrastructure is built; the wiring isn't connected. Until it is, the trust tier classification the LLM router produces is metadata that goes unused.

The `confidenceThreshold` customization is designed but not implemented. `DelegateIntent.confidenceThreshold` exists; the `TrustClassifier` ignores it. Per-user, per-delegation trust calibration is the feature that would make the 0.85 constant feel adaptive rather than arbitrary.

The `sandboxEntityIds` enforcement at the dispatcher level is not explicitly implemented. The `A2UEnvelope` carries the sandbox, and the provenance record includes `allowedEntityIds`, but `dispatch()` doesn't actually check whether `envelope.intent.intent`'s target falls within the sandbox before executing. The check is implied by the architecture but absent in the code.

The `discuss` option in `CheckpointIntent` has no implementation path in the VS Code extension. The button is defined in the waypoint, but `handleAmbiguities()` doesn't model the conversational loop that would follow a "discuss" response.

**The honest summary:** The A2U protocol is one of the most complete and principled designs for human-in-the-loop agent control in any open-source project. The architecture is right. The gaps are in the wiring and enforcement — specifically: connecting the user command path through the dispatcher, implementing the `confidenceThreshold` override, enforcing the sandbox check in `dispatch()`, and building the `discuss` conversational loop. Each gap is a concrete, well-scoped implementation task, not an architectural problem. The design earns the implementation debt it carries.

---

## What's Next

[Part 9 — The Audio Pipeline](#) goes to the place where USIR's ambitions are most concretely tested against engineering reality: getting reliable voice input into a VS Code extension. The Node.js extension host cannot access the Web Audio API; the solution involves a hidden webview doing audio capture and relaying frames over `postMessage` IPC. Whisper, VAD, the local-first fallback chain, and the cold-start latency problem are all in scope.

---

*This post is part of the **Decoding the Post-GUI Runtime** series — a 14-part technical deep-dive into the Universal Semantic Interaction Runtime. All code excerpts are from the USIR repository as of its current pre-alpha state.*
