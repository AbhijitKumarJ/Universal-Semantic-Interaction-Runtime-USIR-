/**
 * Semantic Snapshot — what every adapter emits.
 *
 * The runtime only ever sees Snapshots. It never touches pixels, DOM, or
 * accessibility trees directly.
 *
 * The tiered structure (Hot/Warm/Cold) is the critical engineering insight:
 * it lets the runtime serve a sub-16ms Hot Tier for cursor/selection state
 * while still having full LSP/workspace context available asynchronously.
 */

import type { SemanticGraph } from '../graph';
import type { SemanticEntity, SpatialBounds } from '../entities';

/**
 * The Tier 1 (Hot) snapshot — updated in <16ms.
 *
 * This is the "invocation anchor" — what the user is *doing right now*.
 * It is small enough to compute synchronously and shipped as the first
 * thing in any LLM request.
 */
export interface HotSnapshot {
  tier: 'hot';
  /** The currently focused surface (file explorer, editor, terminal) */
  activeRegion: string;
  /** Active entity — the file/panel in focus */
  activeEntity: SemanticEntity;
  /** All selected entities (multi-select support) */
  selections: SemanticEntity[];
  /** Where the user's pointer is (for FusedIntent) */
  pointerTarget?: { entityId: string; bounds: SpatialBounds };
  /** Recent ephemeral state — what changed in last 100ms */
  ephemeral: Array<{ entityId: string; kind: 'select' | 'edit' | 'open' | 'close'; at: number }>;
  /** Captured at (epoch ms) */
  capturedAt: number;
  /** Latency target for this tier: 16ms */
  latencyBudgetMs: 16;
}

/**
 * The Tier 2 (Warm) snapshot — updated in ~150ms.
 *
 * What is currently visible and what just changed. Used for context
 * resolution when the user says "the panel on the right".
 */
export interface WarmSnapshot {
  tier: 'warm';
  /** All entities currently visible on screen */
  visible: SemanticEntity[];
  /** All entities that changed in the last few seconds */
  recentlyChanged: Array<{ entity: SemanticEntity; delta: Record<string, unknown> }>;
  /** Active panel structure (e.g. file tree, tabs, terminal panes) */
  panelLayout: Array<{ panelId: string; kind: string; bounds: SpatialBounds }>;
  capturedAt: number;
  latencyBudgetMs: 150;
}

/**
 * The Tier 3 (Cold) snapshot — updated in seconds, async.
 *
 * The full graph: LSP symbols, workspace files, git state, dependencies.
 * Sent to the LLM in the second wave of context gathering.
 */
export interface ColdSnapshot {
  tier: 'cold';
  /** Full semantic graph from this adapter */
  graph: SemanticGraph;
  /** LSP-augmented metadata: types, definitions, references */
  lspMetadata: Record<string, LspEntityMetadata>;
  /** Captured at (epoch ms) */
  capturedAt: number;
  latencyBudgetMs: number;
}

export interface LspEntityMetadata {
  entityId: string;
  type?: string;
  documentation?: string;
  definitionEntityId?: string;
  referencesEntityIds?: string[];
  diagnostics?: Array<{ severity: 'error' | 'warning' | 'info'; message: string; range: { start: number; end: number } }>;
}

/**
 * The complete snapshot — the union of all three tiers.
 *
 * Adapters update each tier independently. The runtime typically only
 * needs the Hot + a subset of Warm for sub-second interaction.
 */
export interface SemanticSnapshot {
  hot: HotSnapshot;
  warm: WarmSnapshot;
  cold?: ColdSnapshot;
  /** Which adapter produced this */
  source: string;
  /** Monotonic version number for the whole snapshot */
  version: number;
  /** When this snapshot was assembled (different from hot.capturedAt) */
  assembledAt: number;
}

export function createEmptyHotSnapshot(activeEntity: SemanticEntity, activeRegion: string): HotSnapshot {
  return {
    tier: 'hot',
    activeRegion,
    activeEntity,
    selections: [],
    ephemeral: [],
    capturedAt: Date.now(),
    latencyBudgetMs: 16,
  };
}
