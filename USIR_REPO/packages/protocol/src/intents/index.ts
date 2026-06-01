/**
 * Universal Intent Ontology
 *
 * The 8-layer hierarchy of cognitive verbs that USIR exposes. This is
 * the "HTTP of interaction" — every app, agent, and adapter must speak it.
 *
 * L0  Meta          — about the conversation/system itself
 * L0.5 Provenance   — about the history/why of mutations
 * L1  Navigation    — finding/positioning in the semantic graph
 * L2  Attention     — focus/selection within a surface
 * L3  Information   — read/understand/compute
 * L4  Manipulation  — modify existing entities
 * L5  Creation      — make new entities
 * L6  Execution     — trigger external effects
 * L7  Delegation    — hand off to agents
 * L8  Collaboration — share with other runtimes
 */

import type { SemanticEntity } from '../entities';
import type { CognitiveReference } from '../memory';

// ─────────────────────────────────────────────────────────────────────────────
// Base
// ─────────────────────────────────────────────────────────────────────────────

export type IntentLayer = 0 | 0.5 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface BaseIntent {
  type: string;
  intentId: string;
  /** When the intent was generated (epoch ms) */
  timestamp: number;
  /** The user/agent who originated the intent */
  actor: IntentActor;
  /** Original raw instruction (user's voice/text) */
  rawInstruction?: string;
  /** Confidence in the parsed intent, 0-1 */
  confidence: number;
  /** Ambiguities that the runtime could not auto-resolve */
  ambiguities?: Ambiguity[];
}

export interface IntentActor {
  type: 'user' | 'agent' | 'system';
  id: string;
  /** For agents — confidence the agent has in its own plan */
  agentConfidence?: number;
}

export interface Ambiguity {
  /** JSON-path-like field reference: e.g. "steps[0].args.target" */
  field: string;
  candidates: string[];
  question: string;
  /** Suggested options the user can pick from */
  options?: string[];
}

/** Envelope wrapping any intent for routing */
export interface IntentEnvelope<T extends BaseIntent = BaseIntent> {
  intent: T;
  /** Target entity or reference (the "it") */
  target?: SemanticEntity | CognitiveReference;
  /** Additional arguments specific to the intent */
  args?: Record<string, unknown>;
  /** Intent IDs this one depends on (for topological execution) */
  dependsOn?: string[];
  /** If true, failure does not abort the plan */
  optional?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// L0: Meta Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaIntent extends BaseIntent {
  type: 'intent.meta.cancel' | 'intent.meta.repeat' | 'intent.meta.help' | 'intent.meta.undo' | 'intent.meta.redo';
}

// ─────────────────────────────────────────────────────────────────────────────
// L1: Navigation Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface LocateIntent extends BaseIntent {
  type: 'intent.navigation.locate';
  target: CognitiveReference;
  /** Optional filters to narrow down */
  filters?: {
    role?: string;
    attributes?: Record<string, unknown>;
    spatial?: { region: string; radius?: number };
  };
}

export interface OpenIntent extends BaseIntent {
  type: 'intent.navigation.open';
  target: CognitiveReference;
}

export interface CloseIntent extends BaseIntent {
  type: 'intent.navigation.close';
  target: CognitiveReference;
}

export interface NavigateIntent extends BaseIntent {
  type: 'intent.navigation.navigate';
  target: CognitiveReference;
  /** Destination: file, function, line, etc. */
  destination?: { entity: CognitiveReference; cursor?: { line: number; column: number } };
}

// ─────────────────────────────────────────────────────────────────────────────
// L2: Attention Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface FocusIntent extends BaseIntent {
  type: 'intent.attention.focus';
  target: CognitiveReference;
  /** Which panel/region to focus (file explorer, terminal, editor) */
  region?: string;
}

export interface SelectIntent extends BaseIntent {
  type: 'intent.attention.select';
  target: CognitiveReference;
  selection?: { start: number; end: number };
}

export interface HighlightIntent extends BaseIntent {
  type: 'intent.attention.highlight';
  target: CognitiveReference;
  /** Visual style for disambiguation (e.g. "hand-wave animation") */
  style?: string;
  durationMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// L3: Information Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface ExplainIntent extends BaseIntent {
  type: 'intent.information.explain';
  target: CognitiveReference;
  /** Desired level of detail */
  depth?: 'brief' | 'normal' | 'detailed';
}

export interface SummarizeIntent extends BaseIntent {
  type: 'intent.information.summarize';
  target: CognitiveReference;
  maxLength?: number;
}

export interface CompareIntent extends BaseIntent {
  type: 'intent.information.compare';
  targets: Array<CognitiveReference>;
  /** What dimension to compare (semantics, syntax, behavior) */
  dimension?: string;
}

export interface SearchIntent extends BaseIntent {
  type: 'intent.information.search';
  query: string;
  scope?: CognitiveReference;
}

// ─────────────────────────────────────────────────────────────────────────────
// L4: Manipulation Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface EditIntent extends BaseIntent {
  type: 'intent.manipulation.edit';
  target: CognitiveReference;
  operation: 'rename' | 'replace' | 'insert' | 'delete' | 'transform';
  /** New value or transformation spec */
  value?: string | Record<string, unknown>;
}

export interface MoveIntent extends BaseIntent {
  type: 'intent.manipulation.move';
  target: CognitiveReference;
  destination: CognitiveReference;
}

export interface DeleteIntent extends BaseIntent {
  type: 'intent.manipulation.delete';
  target: CognitiveReference;
  /** If true, soft-delete (recoverable) */
  soft?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// L5: Creation Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateIntent extends BaseIntent {
  type: 'intent.manipulation.create';
  /** What kind of entity to create (role) */
  entityRole: string;
  /** Where to create it */
  parent: CognitiveReference;
  /** Initial name and content */
  name: string;
  template?: string;
  content?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L6: Execution Intents
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteIntent extends BaseIntent {
  type: 'intent.execution.run';
  /** What to execute (test, command, build, etc.) */
  target: CognitiveReference;
  command?: string;
  args?: string[];
}

export interface ScheduleIntent extends BaseIntent {
  type: 'intent.execution.schedule';
  target: CognitiveReference;
  when: string;
  recurring?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L7: Delegation Intents (autonomous agents)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanIntent extends BaseIntent {
  type: 'intent.delegation.plan';
  target: SemanticEntity | CognitiveReference;
  objective: string;
}

export interface DelegateIntent extends BaseIntent {
  type: 'intent.delegation.delegate';
  target: SemanticEntity | CognitiveReference;
  objective: string;
  /** User-defined constraints the agent must respect */
  constraints?: string[];
  /** Confidence threshold below which the agent must checkpoint (default 0.85) */
  confidenceThreshold?: number;
  /** Sandbox: which entities the agent may touch */
  sandboxEntityIds?: string[];
  /** Max execution time before forced checkpoint (ms) */
  maxExecutionMs?: number;
}

export interface CheckpointIntent extends BaseIntent {
  type: 'intent.delegation.checkpoint';
  /** The plan step being approved/rejected */
  stepIndex: number;
  decision: 'approve' | 'reject' | 'discuss';
  rationale?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L8: Collaboration Intents (federation)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareIntent extends BaseIntent {
  type: 'intent.collaboration.share';
  target: SemanticEntity | SemanticEntity[];
  collaboratorId: string;
  /** USIR identity, e.g. decentralized DID */
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
  /** Decoupled from BroadcastIntent for cleaner concerns */
  anchor?: { spatial?: unknown; temporal?: unknown };
}

export interface BroadcastIntent extends BaseIntent {
  type: 'intent.collaboration.broadcast';
  annotationId: string;
  recipients: string[];
  modality?: 'voice' | 'text' | 'spatial';
}

// ─────────────────────────────────────────────────────────────────────────────
// Union type for ALL intents
// ─────────────────────────────────────────────────────────────────────────────

export type UniversalIntent =
  | MetaIntent
  | LocateIntent
  | OpenIntent
  | CloseIntent
  | NavigateIntent
  | FocusIntent
  | SelectIntent
  | HighlightIntent
  | ExplainIntent
  | SummarizeIntent
  | CompareIntent
  | SearchIntent
  | EditIntent
  | MoveIntent
  | DeleteIntent
  | CreateIntent
  | ExecuteIntent
  | ScheduleIntent
  | PlanIntent
  | DelegateIntent
  | CheckpointIntent
  | ShareIntent
  | DiscussIntent
  | AnnotateIntent
  | BroadcastIntent;

// ─────────────────────────────────────────────────────────────────────────────
// Type guards (helpers for runtime)
// ─────────────────────────────────────────────────────────────────────────────

export function getIntentLayer(intent: BaseIntent): IntentLayer {
  if (intent.type.startsWith('intent.meta.')) return 0;
  if (intent.type.startsWith('intent.navigation.')) return 1;
  if (intent.type.startsWith('intent.attention.')) return 2;
  if (intent.type.startsWith('intent.information.')) return 3;
  if (intent.type.startsWith('intent.manipulation.')) return 4;
  if (intent.type.startsWith('intent.creation.')) return 5;
  if (intent.type.startsWith('intent.execution.')) return 6;
  if (intent.type.startsWith('intent.delegation.')) return 7;
  if (intent.type.startsWith('intent.collaboration.')) return 8;
  return 0;
}

export function isMutatingIntent(intent: BaseIntent): boolean {
  const layer = getIntentLayer(intent);
  return layer >= 4;
}

export function isReversibleIntent(intent: BaseIntent): boolean {
  // L4 mutations are generally reversible; L5 creation is partially;
  // L6 execution depends on what was executed.
  if (intent.type === 'intent.manipulation.delete') return false;
  if (intent.type === 'intent.execution.run') return false;
  if (intent.type === 'intent.collaboration.share') return false;
  return true;
}
