import type { BroadcastIntent } from '@usir/protocol/intents';
import type { DataChannelManager } from '../connection/data-channel';
import type { PeerDirectory } from '../discovery/peer-directory';
import { createMessage, type FederationEnvelope } from '../message';

export interface BroadcastResult {
  success: boolean;
  sentTo: string[];
  failedTo: string[];
  error?: string;
}

export class BroadcastHandler {
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

  async execute(intent: BroadcastIntent): Promise<BroadcastResult> {
    const recipients = intent.recipients;
    const sentTo: string[] = [];
    const failedTo: string[] = [];

    if (recipients.length === 0) {
      const onlinePeers = this.peerDirectory.list({ status: 'online' });
      for (const peer of onlinePeers) {
        if (peer.peerId === this.localPeerId) continue;
        const envelope = this.buildEnvelope(intent, peer.peerId);
        this.dcManager.send(envelope);
        sentTo.push(peer.peerId);
      }
    } else {
      for (const recipientId of recipients) {
        const peer = this.peerDirectory.getPeer(recipientId);
        if (peer && peer.status === 'online') {
          const envelope = this.buildEnvelope(intent, recipientId);
          this.dcManager.send(envelope);
          sentTo.push(recipientId);
        } else {
          failedTo.push(recipientId);
        }
      }
    }

    return {
      success: sentTo.length > 0,
      sentTo,
      failedTo,
    };
  }

  private buildEnvelope(intent: BroadcastIntent, targetId: string): FederationEnvelope {
    const payload = {
      annotationId: intent.annotationId,
      modality: intent.modality ?? 'text',
      actorId: intent.actor.id,
    };

    return createMessage(
      'federation.intent',
      this.localPeerId,
      {
        intentType: 'intent.collaboration.broadcast',
        serializedEnvelope: JSON.stringify({
          intent: { ...intent },
          payload,
        }),
        originRuntimeId: this.localPeerId,
        ttl: 30,
      },
      targetId,
    );
  }
}
