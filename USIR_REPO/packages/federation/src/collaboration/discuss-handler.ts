import type { DiscussIntent } from '@usir/protocol/intents';
import type { SemanticEntity } from '@usir/protocol/entities';
import type { DataChannelManager } from '../connection/data-channel';
import type { PeerDirectory } from '../discovery/peer-directory';
import { createMessage, type CapabilityPayload } from '../message';

export interface DiscussionThread {
  threadId: string;
  targetEntityId: string;
  targetEntityName: string;
  participants: string[];
  messages: DiscussionMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionMessage {
  messageId: string;
  authorId: string;
  text: string;
  modality: DiscussIntent['preferredModality'];
  timestamp: number;
}

export interface DiscussResult {
  success: boolean;
  threadId: string;
  messageId: string;
  deliveredTo: string[];
  error?: string;
}

export class DiscussHandler {
  private threads: Map<string, DiscussionThread> = new Map();
  private dcManager: DataChannelManager;
  private peerDirectory: PeerDirectory;
  private localPeerId: string;

  constructor(deps: {
    localPeerId: string;
    dcManager: DataChannelManager;
    peerDirectory: PeerDirectory;
  }) {
    this.localPeerId = deps.localPeerId;
    this.dcManager = deps.dcManager;
    this.peerDirectory = deps.peerDirectory;
  }

  async execute(intent: DiscussIntent): Promise<DiscussResult> {
    const targetId = intent.target.id;
    const thread = this.findOrCreateThread(targetId, intent.target.displayName);

    const message: DiscussionMessage = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      authorId: intent.actor.id,
      text: intent.message,
      modality: intent.preferredModality ?? 'text',
      timestamp: Date.now(),
    };
    thread.messages.push(message);
    thread.updatedAt = Date.now();

    if (!thread.participants.includes(intent.actor.id)) {
      thread.participants.push(intent.actor.id);
    }

    const deliveredTo: string[] = [];
    const participants = [...thread.participants];
    for (const participantId of participants) {
      if (participantId === this.localPeerId) continue;
      const peer = this.peerDirectory.getPeer(participantId);
      if (peer && peer.status === 'online') {
        const envelope = createMessage(
          'federation.intent',
          this.localPeerId,
          {
            intentType: 'intent.collaboration.discuss',
              serializedEnvelope: JSON.stringify({
                intent: { ...intent, message: intent.message },
                threadId: thread.threadId,
                message,
              }),
            originRuntimeId: this.localPeerId,
          },
          participantId,
        );
        this.dcManager.send(envelope);
        deliveredTo.push(participantId);
      }
    }

    return {
      success: true,
      threadId: thread.threadId,
      messageId: message.messageId,
      deliveredTo,
    };
  }

  handleIncomingMessage(intent: DiscussIntent, threadId: string, message: DiscussionMessage): void {
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = {
        threadId,
        targetEntityId: intent.target.id,
        targetEntityName: intent.target.displayName,
        participants: [],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.threads.set(threadId, thread);
    }
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if (!thread.participants.includes(intent.actor.id)) {
      thread.participants.push(intent.actor.id);
    }
  }

  getThread(threadId: string): DiscussionThread | undefined {
    return this.threads.get(threadId);
  }

  getThreadsForEntity(entityId: string): DiscussionThread[] {
    const result: DiscussionThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.targetEntityId === entityId) {
        result.push(thread);
      }
    }
    return result;
  }

  getThreadsForParticipant(participantId: string): DiscussionThread[] {
    const result: DiscussionThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.participants.includes(participantId)) {
        result.push(thread);
      }
    }
    return result;
  }

  getRecentThreads(limit: number = 10): DiscussionThread[] {
    return Array.from(this.threads.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  private findOrCreateThread(entityId: string, entityName: string): DiscussionThread {
    for (const thread of this.threads.values()) {
      if (thread.targetEntityId === entityId) return thread;
    }
    const thread: DiscussionThread = {
      threadId: `thread_${entityId}`,
      targetEntityId: entityId,
      targetEntityName: entityName,
      participants: [this.localPeerId],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.threads.set(thread.threadId, thread);
    return thread;
  }
}
