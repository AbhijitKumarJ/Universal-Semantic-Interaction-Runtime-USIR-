import type { ShareIntent } from '@usir/protocol/intents';
import type { SemanticEntity } from '@usir/protocol/entities';
import type { FederatedGraph } from '../graph/federated-graph';
import type { DataChannelManager } from '../connection/data-channel';
import type { PeerDirectory } from '../discovery/peer-directory';
import { createMessage } from '../message';

export interface SharedEntity {
  entityId: string;
  sharedWith: string;
  permissions: ShareIntent['permissions'];
  sharedAt: number;
  expiresAt?: number;
}

export interface ShareResult {
  success: boolean;
  sharedEntities: string[];
  collaboratorId: string;
  error?: string;
}

export class ShareHandler {
  private graph: FederatedGraph;
  private dcManager: DataChannelManager;
  private peerDirectory: PeerDirectory;
  private sharedEntities: Map<string, SharedEntity> = new Map();
  private localPeerId: string;

  constructor(deps: {
    localPeerId: string;
    graph: FederatedGraph;
    dcManager: DataChannelManager;
    peerDirectory: PeerDirectory;
  }) {
    this.localPeerId = deps.localPeerId;
    this.graph = deps.graph;
    this.dcManager = deps.dcManager;
    this.peerDirectory = deps.peerDirectory;
  }

  async execute(intent: ShareIntent): Promise<ShareResult> {
    const targets = Array.isArray(intent.target) ? intent.target : [intent.target];
    const peer = this.peerDirectory.getPeer(intent.collaboratorId);
    if (!peer) {
      return {
        success: false,
        sharedEntities: [],
        collaboratorId: intent.collaboratorId,
        error: `Peer ${intent.collaboratorId} not found`,
      };
    }

    const sharedIds: string[] = [];

    for (const target of targets) {
      const entityId = this.resolveEntityId(target);
      if (!entityId) continue;

      if (!this.graph.hasEntity(entityId)) {
        continue;
      }

      const entity = this.graph.exportGraph().nodes.get(entityId)?.entity;
      if (!entity) continue;

      const envelope = createMessage(
        'federation.intent',
        this.localPeerId,
        {
          intentType: 'intent.collaboration.share',
          serializedEnvelope: JSON.stringify({
            intent: { ...intent },
            target: entity,
          }),
          originRuntimeId: this.localPeerId,
          ttl: 60,
        },
        intent.collaboratorId,
      );
      this.dcManager.send(envelope);

      const shared: SharedEntity = {
        entityId,
        sharedWith: intent.collaboratorId,
        permissions: intent.permissions,
        sharedAt: Date.now(),
        expiresAt: intent.expiresAt,
      };
      this.sharedEntities.set(`${entityId}:${intent.collaboratorId}`, shared);
      sharedIds.push(entityId);
    }

    return {
      success: sharedIds.length > 0,
      sharedEntities: sharedIds,
      collaboratorId: intent.collaboratorId,
    };
  }

  revokeShare(entityId: string, collaboratorId: string): boolean {
    return this.sharedEntities.delete(`${entityId}:${collaboratorId}`);
  }

  getPermissions(entityId: string, collaboratorId: string): ShareIntent['permissions'] | undefined {
    return this.sharedEntities.get(`${entityId}:${collaboratorId}`)?.permissions;
  }

  hasPermission(entityId: string, collaboratorId: string, permission: 'read' | 'comment' | 'edit' | 'delegate'): boolean {
    const perms = this.getPermissions(entityId, collaboratorId);
    return perms !== undefined && perms.includes(permission);
  }

  getSharedWithMe(collaboratorId: string): SharedEntity[] {
    const result: SharedEntity[] = [];
    for (const entry of this.sharedEntities.values()) {
      if (entry.sharedWith === collaboratorId) {
        result.push(entry);
      }
    }
    return result;
  }

  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.sharedEntities) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.sharedEntities.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  private resolveEntityId(target: SemanticEntity | { resolvedEntityId?: string; refId: string }): string | undefined {
    if ('id' in target && target.id) return target.id;
    if ('resolvedEntityId' in target && target.resolvedEntityId) return target.resolvedEntityId;
    return undefined;
  }
}
