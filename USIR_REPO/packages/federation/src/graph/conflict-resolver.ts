import type { FederatedGraphEvent } from './federated-graph';

export type ConflictStrategy = 'lww' | 'intent_priority' | 'authority_wins' | 'merge';

export interface ConflictResolution {
  strategy: ConflictStrategy;
  winnerPeerId: string;
  rationale: string;
  field: string;
  entityId: string;
}

export interface IntentAwareConflictConfig {
  /** Intent types that take priority (e.g. 'intent.collaboration.share') */
  priorityIntentTypes: string[];
  /** Peer trust levels that take priority */
  authorityPeerIds: string[];
  /** If true, prefer local changes */
  preferLocal: boolean;
}

export class ConflictResolver {
  private config: IntentAwareConflictConfig = {
    priorityIntentTypes: ['intent.delegation.delegate', 'intent.collaboration.share'],
    authorityPeerIds: [],
    preferLocal: true,
  };

  constructor(config?: Partial<IntentAwareConflictConfig>) {
    if (config) Object.assign(this.config, config);
  }

  updateConfig(config: Partial<IntentAwareConflictConfig>): void {
    Object.assign(this.config, config);
  }

  resolve(
    event: FederatedGraphEvent,
    localPeerId: string,
    remotePeerId: string,
    intentType?: string,
  ): ConflictResolution {
    switch (event.type) {
      case 'node_changed':
      case 'node_removed':
        return this.resolveEntityConflict(event, localPeerId, remotePeerId, intentType);
      case 'meta_changed':
        return { strategy: 'lww', winnerPeerId: remotePeerId, rationale: 'LWW for metadata', field: 'meta', entityId: '' };
      default:
        return { strategy: 'lww', winnerPeerId: remotePeerId, rationale: 'Default LWW', field: 'unknown', entityId: '' };
    }
  }

  private resolveEntityConflict(
    event: FederatedGraphEvent & { entityId: string },
    localPeerId: string,
    remotePeerId: string,
    intentType?: string,
  ): ConflictResolution {
    if (intentType && this.config.priorityIntentTypes.includes(intentType)) {
      return {
        strategy: 'intent_priority',
        winnerPeerId: remotePeerId,
        rationale: `Intent ${intentType} has priority`,
        field: 'entity',
        entityId: event.entityId,
      };
    }

    if (this.config.authorityPeerIds.includes(remotePeerId)) {
      return {
        strategy: 'authority_wins',
        winnerPeerId: remotePeerId,
        rationale: `Remote peer ${remotePeerId} is an authority`,
        field: 'entity',
        entityId: event.entityId,
      };
    }

    if (this.config.authorityPeerIds.includes(localPeerId)) {
      return {
        strategy: 'authority_wins',
        winnerPeerId: localPeerId,
        rationale: `Local peer ${localPeerId} is an authority`,
        field: 'entity',
        entityId: event.entityId,
      };
    }

    if (this.config.preferLocal) {
      return {
        strategy: 'lww',
        winnerPeerId: localPeerId,
        rationale: 'Default LWW with local preference',
        field: 'entity',
        entityId: event.entityId,
      };
    }

    return {
      strategy: 'lww',
      winnerPeerId: remotePeerId,
      rationale: 'Default LWW with remote preference',
      field: 'entity',
      entityId: event.entityId,
    };
  }

  shouldAcceptRemoteChange(resolution: ConflictResolution, localPeerId: string): boolean {
    if (resolution.strategy === 'lww') return true;
    return resolution.winnerPeerId !== localPeerId;
  }
}
