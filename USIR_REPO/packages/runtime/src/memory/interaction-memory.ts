/**
 * Interaction Memory — solves "it", "that", "previous".
 *
 * The most underrated layer in USIR. Voice computing remains frustrating
 * without persistent contextual grounding. This module is the runtime
 * half of the InteractionMemory feature.
 */

import type {
  CognitiveReference,
  ConversationTurn,
  InteractionMemorySnapshot,
  SemanticReference,
  SpatialReference,
  TemporalReference,
  ConversationalReference,
} from '@usir/protocol/memory';
import type { SemanticEntity } from '@usir/protocol/entities';

const HISTORY_LIMIT = 50;

export class InteractionMemory {
  private history: string[] = [];
  private lastDiscussed: string | null = null;
  private conversationHistory: ConversationTurn[] = [];
  private sessionStartedAt: number = Date.now();
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Push an entity to the front of the history. Called whenever
   * the user references, opens, edits, or discusses an entity.
   */
  public pushToHistory(entityId: string, options?: { intentId?: string; rawInput?: string }): void {
    this.history = this.history.filter((id) => id !== entityId);
    this.history.unshift(entityId);
    if (this.history.length > HISTORY_LIMIT) this.history.pop();
    this.lastDiscussed = entityId;
    if (options?.rawInput) {
      this.conversationHistory.push({
        turnId: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        rawInput: options.rawInput,
        resolvedIntentId: options.intentId,
        touchedEntityIds: [entityId],
      });
    }
  }

  /**
   * Resolve a CognitiveReference to a concrete entity id.
   * This is the heart of voice-friendly interaction.
   */
  public resolve(reference: CognitiveReference, candidateEntities: SemanticEntity[]): string | null {
    switch (reference.kind) {
      case 'temporal':
        return this.resolveTemporal(reference);
      case 'conversational':
        return this.resolveConversational(reference);
      case 'spatial':
        return this.resolveSpatial(reference, candidateEntities);
      case 'semantic':
        return this.resolveSemantic(reference, candidateEntities);
    }
  }

  private resolveTemporal(ref: TemporalReference): string | null {
    if (!ref.eventType) {
      // Default: most recent
      return this.history[0] ?? null;
    }
    // For now: simple heuristic. Real impl would index by event type.
    return this.history[0] ?? null;
  }

  private resolveConversational(ref: ConversationalReference): string | null {
    const pos = ref.position ?? 'most_recent';
    switch (pos) {
      case 'most_recent':
      case 'previous':
        return this.history[0] ?? null;
      case 'next':
        return this.history[1] ?? null;
      case 'first':
        return this.history[this.history.length - 1] ?? null;
      case 'last':
        return this.history[0] ?? null;
    }
    if (ref.stepsBack != null) {
      return this.history[ref.stepsBack] ?? null;
    }
    return null;
  }

  private resolveSpatial(ref: SpatialReference, candidates: SemanticEntity[]): string | null {
    if (!ref.anchorEntityId) return null;
    const anchor = candidates.find((e) => e.id === ref.anchorEntityId);
    if (!anchor?.spatial) return null;
    // Find candidates that are spatially related
    const matches = candidates.filter((e) => {
      if (e.id === ref.anchorEntityId) return false;
      if (!e.spatial) return false;
      return this.isSpatialMatch(anchor.spatial!, e.spatial!, ref);
    });
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0]!.id;
    // Apply size/visual attribute filters
    if (ref.sizeRelation) {
      const sizeFiltered = matches.filter((e) => this.matchesSizeRelation(anchor, e, ref.sizeRelation!));
      if (sizeFiltered.length > 0) return sizeFiltered[0]!.id;
    }
    return matches[0]!.id;
  }

  private resolveSemantic(ref: SemanticReference, candidates: SemanticEntity[]): string | null {
    // Simple substring match in display name and role. Real impl would use embeddings.
    const desc = ref.description.toLowerCase();
    const matches = candidates.filter((e) => e.displayName.toLowerCase().includes(desc) || e.role.toLowerCase().includes(desc));
    return matches[0]?.id ?? null;
  }

  private isSpatialMatch(anchor: any, target: any, ref: SpatialReference): boolean {
    if (!ref.direction) return true;
    switch (ref.direction) {
      case 'below':
        return target.y > anchor.y + anchor.height;
      case 'above':
        return target.y + target.height < anchor.y;
      case 'left':
        return target.x + target.width < anchor.x;
      case 'right':
        return target.x > anchor.x + anchor.width;
      case 'next_to':
        return Math.abs(target.y - anchor.y) < 50;
      case 'inside':
        return target.x >= anchor.x && target.y >= anchor.y && target.x + target.width <= anchor.x + anchor.width && target.y + target.height <= anchor.y + anchor.height;
    }
    return false;
  }

  private matchesSizeRelation(anchor: SemanticEntity, target: SemanticEntity, relation: 'wider' | 'taller' | 'smaller' | 'larger' | 'bigger'): boolean {
    if (!anchor.spatial || !target.spatial) return false;
    const anchorArea = (anchor.spatial as any).width * (anchor.spatial as any).height;
    const targetArea = (target.spatial as any).width * (target.spatial as any).height;
    switch (relation) {
      case 'wider':
        return (target.spatial as any).width > (anchor.spatial as any).width;
      case 'taller':
        return (target.spatial as any).height > (anchor.spatial as any).height;
      case 'smaller':
        return targetArea < anchorArea;
      case 'larger':
      case 'bigger':
        return targetArea > anchorArea;
    }
  }

  public snapshot(): InteractionMemorySnapshot {
    return {
      recentEntityIds: [...this.history],
      lastDiscussedEntityId: this.lastDiscussed,
      conversationHistory: [...this.conversationHistory],
      sessionStartedAt: this.sessionStartedAt,
      userId: this.userId,
    };
  }

  public clear(): void {
    this.history = [];
    this.lastDiscussed = null;
    this.conversationHistory = [];
    this.sessionStartedAt = Date.now();
  }
}
