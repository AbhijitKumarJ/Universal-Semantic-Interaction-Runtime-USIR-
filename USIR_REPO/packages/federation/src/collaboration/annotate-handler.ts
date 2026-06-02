import type { AnnotateIntent } from '@usir/protocol/intents';
import type { FederatedGraph } from '../graph/federated-graph';
import type { DataChannelManager } from '../connection/data-channel';
import type { PeerDirectory } from '../discovery/peer-directory';
import { createMessage } from '../message';

export interface Annotation {
  annotationId: string;
  entityId: string;
  authorId: string;
  text: string;
  anchor?: { spatial?: unknown; temporal?: unknown };
  timestamp: number;
}

export interface AnnotateResult {
  success: boolean;
  annotationId: string;
  entityId: string;
  error?: string;
}

export class AnnotateHandler {
  private graph: FederatedGraph;
  private dcManager: DataChannelManager;
  private peerDirectory: PeerDirectory;
  private localPeerId: string;
  private annotations: Map<string, Annotation> = new Map();
  private entityAnnotations: Map<string, string[]> = new Map();

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

  async execute(intent: AnnotateIntent): Promise<AnnotateResult> {
    const entityId = intent.target.id;
    if (!this.graph.hasEntity(entityId)) {
      return {
        success: false,
        annotationId: '',
        entityId,
        error: `Entity ${entityId} not found in local graph`,
      };
    }

    const annotation: Annotation = {
      annotationId: `anno_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      entityId,
      authorId: intent.actor.id,
      text: intent.annotation,
      anchor: intent.anchor,
      timestamp: Date.now(),
    };

    this.annotations.set(annotation.annotationId, annotation);

    if (!this.entityAnnotations.has(entityId)) {
      this.entityAnnotations.set(entityId, []);
    }
    this.entityAnnotations.get(entityId)!.push(annotation.annotationId);

    this.graph.updateEntity(entityId, [
      { field: 'attributes', value: { annotation: intent.annotation, annotatedBy: intent.actor.id, annotatedAt: annotation.timestamp } },
    ]);

    const participants = this.peerDirectory.list({ status: 'online' });
    for (const peer of participants) {
      if (peer.peerId === this.localPeerId) continue;
      const envelope = createMessage(
        'federation.intent',
        this.localPeerId,
        {
          intentType: 'intent.collaboration.annotate',
          serializedEnvelope: JSON.stringify({ intent, annotation }),
          originRuntimeId: this.localPeerId,
        },
        peer.peerId,
      );
      this.dcManager.send(envelope);
    }

    return {
      success: true,
      annotationId: annotation.annotationId,
      entityId,
    };
  }

  handleIncomingAnnotation(intent: AnnotateIntent, annotation: Annotation): void {
    this.annotations.set(annotation.annotationId, annotation);
    if (!this.entityAnnotations.has(annotation.entityId)) {
      this.entityAnnotations.set(annotation.entityId, []);
    }
    this.entityAnnotations.get(annotation.entityId)!.push(annotation.annotationId);
  }

  getAnnotations(entityId: string): Annotation[] {
    const ids = this.entityAnnotations.get(entityId) ?? [];
    return ids.map((id) => this.annotations.get(id)!).filter(Boolean);
  }

  getAllAnnotations(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  removeAnnotation(annotationId: string): boolean {
    const anno = this.annotations.get(annotationId);
    if (!anno) return false;
    const entityList = this.entityAnnotations.get(anno.entityId);
    if (entityList) {
      this.entityAnnotations.set(anno.entityId, entityList.filter((id) => id !== annotationId));
    }
    return this.annotations.delete(annotationId);
  }

  clearEntityAnnotations(entityId: string): number {
    const ids = this.entityAnnotations.get(entityId) ?? [];
    for (const id of ids) this.annotations.delete(id);
    this.entityAnnotations.delete(entityId);
    return ids.length;
  }
}
