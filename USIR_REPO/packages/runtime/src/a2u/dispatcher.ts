/**
 * A2U Dispatcher — the gatekeeper for agent-to-USIR communication.
 *
 * When a Worker Agent generates an A2UEnvelope, the dispatcher decides
 * whether to execute immediately, queue for review, surface a checkpoint,
 * or interrupt the user with a blocker.
 */

import type { BaseIntent, IntentEnvelope } from '@usir/protocol/intents';
import type { InteractionWaypoint } from '@usir/protocol/waypoint';
import type { ProvenanceStore } from '../provenance/provenance-store';
import type { TopologicalExecutor } from '../executor/topological-executor';
import type { TrustClassifier } from './trust-classifier';

export type Urgency = 'background' | 'checkpoint' | 'blocker';

export interface A2UEnvelope {
  intent: IntentEnvelope;
  agentState: {
    workerId: string;
    parentDelegateIntentId: string;
    planProgress: { totalSteps: number; completedSteps: number; currentPhase: string; estimatedRemaining: number };
    sandboxEntityIds: string[];
    confidence: number;
    uncertainty?: string;
  };
  surfacingReason:
    | { type: 'checkpoint'; description: string }
    | { type: 'uncertainty'; question: string; options?: string[] }
    | { type: 'constraint-violation'; constraint: string; proposed: string }
    | { type: 'completion'; summary: string }
    | { type: 'failure'; reason: string; recoverable: boolean };
  urgency: Urgency;
  defaultBehaviour: {
    action: 'proceed' | 'pause' | 'abort';
    timeoutMs: number;
    proceedCondition?: string;
  };
}

export interface DispatchResult {
  status: 'executed' | 'queued' | 'pending-approval' | 'blocked';
  result?: unknown;
  waypointId?: string;
}

export class A2UDispatcher {
  constructor(
    private trustClassifier: TrustClassifier,
    private provenanceStore: ProvenanceStore,
    private executor: TopologicalExecutor,
  ) {}

  public async dispatch(envelope: A2UEnvelope): Promise<DispatchResult> {
    const trust = this.trustClassifier.classify(envelope.intent.intent, envelope.agentState.confidence);

    // 1. Always record to provenance
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
      entityBefore: { id: '', displayName: '', role: 'unknown', attributes: {}, relations: [], updatedAt: 0, source: 'agent' },
      entityAfter: { id: '', displayName: '', role: 'unknown', attributes: {}, relations: [], updatedAt: 0, source: 'agent' },
      causalParents: [envelope.agentState.parentDelegateIntentId],
    });

    // 2. Route based on trust tier and urgency
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

  private async executeImmediate(envelope: A2UEnvelope): Promise<DispatchResult> {
    const result = await this.executor.execute({
      planId: `plan-${envelope.intent.intent.intentId}`,
      rawInstruction: envelope.intent.intent.rawInstruction ?? '',
      steps: [
        {
          stepId: envelope.intent.intent.intentId,
          tool: envelope.intent.intent.type,
          args: envelope.intent.args ?? {},
          dependsOn: envelope.intent.dependsOn ?? [],
          optional: envelope.intent.optional ?? false,
          confidence: envelope.agentState.confidence,
        },
      ],
      ambiguities: [],
      confidence: envelope.agentState.confidence,
      detectedIntentType: envelope.intent.intent.type,
      createdAt: Date.now(),
      trustTier: 1,
    });
    return { status: 'executed', result };
  }

  private async queueForReview(envelope: A2UEnvelope): Promise<DispatchResult> {
    return { status: 'queued', waypointId: `review-${envelope.intent.intent.intentId}` };
  }

  private async surfaceCheckpoint(envelope: A2UEnvelope): Promise<DispatchResult> {
    const waypoint = this.buildCheckpointWaypoint(envelope);
    return { status: 'pending-approval', waypointId: waypoint.id };
  }

  private async interruptUser(envelope: A2UEnvelope): Promise<DispatchResult> {
    const waypoint = this.buildBlockerWaypoint(envelope);
    return { status: 'blocked', waypointId: waypoint.id };
  }

  private buildCheckpointWaypoint(envelope: A2UEnvelope): InteractionWaypoint {
    const phase = envelope.agentState.planProgress.currentPhase;
    return {
      id: `checkpoint-${envelope.intent.intent.intentId}`,
      context: { state: 'agent-checkpoint', objective: `Review: ${phase}` },
      presentations: {
        display: {
          layout: 'diff_review',
          prompt: `Agent wants approval: ${phase}`,
          primaryAction: { label: 'Approve', action: 'approve' },
          secondaryAction: { label: 'Reject', action: 'reject' },
          tertiaryAction: { label: 'Discuss', action: 'discuss' },
        },
        audio: {
          tts: `Checkpoint. ${phase}. ${this.surfacingReasonDescription(envelope)}. Approve, reject, or discuss?`,
        },
        haptic: { pattern: 'notification_double', timing: 'immediate' },
      },
      expectedInputs: {
        voice: {
          intents: [
            { utterances: ['approve', 'yes', 'proceed'], intentType: 'approve' },
            { utterances: ['reject', 'no', 'undo'], intentType: 'reject' },
            { utterances: ['discuss', 'explain', 'why'], intentType: 'discuss' },
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

  private buildBlockerWaypoint(envelope: A2UEnvelope): InteractionWaypoint {
    const reason = envelope.surfacingReason;
    const question = reason.type === 'uncertainty' ? reason.question : 'Agent is blocked and needs your input';
    const options = reason.type === 'uncertainty' && reason.options ? reason.options : [];
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
          intents: options.map((o, i) => ({ utterances: [o.toLowerCase()], intentType: `opt-${i}` })),
        },
      },
      fallback: {
        channels: [{ channel: 'voice_call', spokenSummary: question }],
        timeoutMs: 0,
        onExhaustion: 'queue',
      },
    };
  }

  private surfacingReasonDescription(envelope: A2UEnvelope): string {
    switch (envelope.surfacingReason.type) {
      case 'checkpoint': return envelope.surfacingReason.description;
      case 'uncertainty': return envelope.surfacingReason.question;
      case 'constraint-violation': return `Constraint violation: ${envelope.surfacingReason.constraint}`;
      case 'completion': return `Task complete: ${envelope.surfacingReason.summary}`;
      case 'failure': return `Failure: ${envelope.surfacingReason.reason}`;
    }
  }
}
