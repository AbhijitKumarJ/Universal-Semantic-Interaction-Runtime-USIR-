import type { ShareIntent, DiscussIntent, AnnotateIntent, BroadcastIntent } from '@usir/protocol/intents';
import { ShareHandler } from './share-handler';
import { DiscussHandler } from './discuss-handler';
import { AnnotateHandler } from './annotate-handler';
import { BroadcastHandler } from './broadcast-handler';

export interface L8Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<{
    success: boolean;
    output?: unknown;
    affectedEntityIds: string[];
    error?: string;
  }>;
}

export class L8ToolRegistry {
  private shareHandler: ShareHandler;
  private discussHandler: DiscussHandler;
  private annotateHandler: AnnotateHandler;
  private broadcastHandler: BroadcastHandler;

  constructor(deps: {
    shareHandler: ShareHandler;
    discussHandler: DiscussHandler;
    annotateHandler: AnnotateHandler;
    broadcastHandler: BroadcastHandler;
  }) {
    this.shareHandler = deps.shareHandler;
    this.discussHandler = deps.discussHandler;
    this.annotateHandler = deps.annotateHandler;
    this.broadcastHandler = deps.broadcastHandler;
  }

  getAllTools(): L8Tool[] {
    return [
      this.createShareTool(),
      this.createDiscussTool(),
      this.createAnnotateTool(),
      this.createBroadcastTool(),
    ];
  }

  private createShareTool(): L8Tool {
    return {
      name: 'federation.share',
      description: 'Share semantic entities with a collaborator. Args: target (entity id or array), collaboratorId (string), permissions (array of "read"|"comment"|"edit"|"delegate"), expiresAt? (number)',
      execute: async (args) => {
        const result = await this.shareHandler.execute({
          type: 'intent.collaboration.share',
          intentId: `intent_${Date.now()}`,
          timestamp: Date.now(),
          actor: { type: 'user', id: args.actorId as string ?? 'unknown' },
          confidence: 1,
          target: args.target as ShareIntent['target'],
          collaboratorId: args.collaboratorId as string,
          permissions: args.permissions as ShareIntent['permissions'],
          expiresAt: args.expiresAt as number | undefined,
        });
        return {
          success: result.success,
          output: result,
          affectedEntityIds: result.sharedEntities,
          error: result.error,
        };
      },
    };
  }

  private createDiscussTool(): L8Tool {
    return {
      name: 'federation.discuss',
      description: 'Send a discussion message about a shared entity. Args: target (entity with id/displayName), message (string), preferredModality? ("voice"|"text"|"spatial")',
      execute: async (args) => {
        const result = await this.discussHandler.execute({
          type: 'intent.collaboration.discuss',
          intentId: `intent_${Date.now()}`,
          timestamp: Date.now(),
          actor: { type: 'user', id: args.actorId as string ?? 'unknown' },
          confidence: 1,
          target: args.target as DiscussIntent['target'],
          message: args.message as string,
          preferredModality: args.preferredModality as DiscussIntent['preferredModality'],
        });
        return {
          success: result.success,
          output: result,
          affectedEntityIds: [result.threadId],
          error: result.error,
        };
      },
    };
  }

  private createAnnotateTool(): L8Tool {
    return {
      name: 'federation.annotate',
      description: 'Attach an annotation to a semantic entity. Args: target (entity with id), annotation (string), anchor? ({ spatial?, temporal? })',
      execute: async (args) => {
        const result = await this.annotateHandler.execute({
          type: 'intent.collaboration.annotate',
          intentId: `intent_${Date.now()}`,
          timestamp: Date.now(),
          actor: { type: 'user', id: args.actorId as string ?? 'unknown' },
          confidence: 1,
          target: args.target as AnnotateIntent['target'],
          annotation: args.annotation as string,
          anchor: args.anchor as AnnotateIntent['anchor'],
        });
        return {
          success: result.success,
          output: result,
          affectedEntityIds: [result.entityId],
          error: result.error,
        };
      },
    };
  }

  private createBroadcastTool(): L8Tool {
    return {
      name: 'federation.broadcast',
      description: 'Broadcast an annotation or message to N peers. Args: annotationId (string), recipients (string[] — empty = all online), modality? ("voice"|"text"|"spatial")',
      execute: async (args) => {
        const result = await this.broadcastHandler.execute({
          type: 'intent.collaboration.broadcast',
          intentId: `intent_${Date.now()}`,
          timestamp: Date.now(),
          actor: { type: 'user', id: args.actorId as string ?? 'unknown' },
          confidence: 1,
          annotationId: args.annotationId as string,
          recipients: args.recipients as string[],
          modality: args.modality as BroadcastIntent['modality'],
        });
        return {
          success: result.success,
          output: result,
          affectedEntityIds: result.sentTo,
          error: result.error,
        };
      },
    };
  }
}
