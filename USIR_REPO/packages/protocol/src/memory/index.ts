/**
 * Interaction Memory — the cognitive references that humans actually use.
 *
 * This is the most underrated layer in USIR. Without it, voice computing
 * remains frustrating because users never speak in fully-qualified paths.
 * They say "that file", "the previous one", "the thing below it".
 *
 * This module defines the *types* of references the runtime must resolve.
 * The actual resolution engine lives in @usir/runtime/memory.
 */

/**
 * 4 kinds of cognitive context:
 *  - Temporal:    "the file I opened yesterday"
 *  - Conversational: "compare it with the previous one"
 *  - Spatial:     "the item below that"
 *  - Semantic:    "the design discussion we had earlier"
 */
export type ContextKind = 'temporal' | 'conversational' | 'spatial' | 'semantic';

export interface BaseReference {
  /** Unique reference id */
  refId: string;
  /** What kind of context this draws from */
  kind: ContextKind;
  /** Confidence the resolver has in mapping this to a concrete entity */
  confidence: number;
  /** Optional pin to a specific entity (when resolved) */
  resolvedEntityId?: string;
}

/**
 * "the file I opened yesterday" / "the last test I ran"
 */
export interface TemporalReference extends BaseReference {
  kind: 'temporal';
  /** "yesterday", "last week", "before lunch", "earlier today" */
  relativeTime: string;
  /** Optional event hook: opened / edited / executed / discussed */
  eventType?: 'opened' | 'edited' | 'executed' | 'discussed' | 'created' | 'closed';
}

/**
 * "that one" / "the previous one" / "the first thing they said"
 */
export interface ConversationalReference extends BaseReference {
  kind: 'conversational';
  /** How far back in the conversation */
  stepsBack?: number;
  /** "previous" / "next" / "first" / "last" */
  position?: 'previous' | 'next' | 'first' | 'last' | 'most_recent';
  /** Optional filter on what the referenced item was about */
  topic?: string;
}

/**
 * "the thing below that" / "the panel to the right" / "the wider one"
 */
export interface SpatialReference extends BaseReference {
  kind: 'spatial';
  /** Anchor entity to which the relation is relative */
  anchorEntityId?: string;
  /** "below" / "above" / "left" / "right" / "next_to" / "inside" */
  direction?: 'below' | 'above' | 'left' | 'right' | 'next_to' | 'inside' | 'overlapping';
  /** "wider" / "taller" / "smaller" / "larger" / "bigger" */
  sizeRelation?: 'wider' | 'taller' | 'smaller' | 'larger' | 'bigger';
  /** "blue" / "red" / "wide" / "tall" / "round" */
  visualAttribute?: string;
}

/**
 * "the design discussion we had earlier" / "the JWT bug"
 */
export interface SemanticReference extends BaseReference {
  kind: 'semantic';
  /** Free-form description of the concept being referenced */
  description: string;
  /** Optional topic tag */
  topic?: string;
}

export type CognitiveReference =
  | TemporalReference
  | ConversationalReference
  | SpatialReference
  | SemanticReference;

/**
 * Snapshot of the interaction memory — what the runtime currently "remembers"
 */
export interface InteractionMemorySnapshot {
  /** Recently accessed entities (ring buffer, most recent first) */
  recentEntityIds: string[];
  /** The current "it" — the most recently discussed entity */
  lastDiscussedEntityId: string | null;
  /** Active conversation turn history */
  conversationHistory: ConversationTurn[];
  /** Active session start time */
  sessionStartedAt: number;
  /** User identity */
  userId: string;
}

export interface ConversationTurn {
  turnId: string;
  timestamp: number;
  /** What the user said/typed */
  rawInput: string;
  /** Resolved intent (or null if clarification needed) */
  resolvedIntentId?: string;
  /** Entities referenced/created/modified in this turn */
  touchedEntityIds: string[];
}
