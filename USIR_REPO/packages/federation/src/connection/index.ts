import { transitionState, isConnected, type PeerConnectionState, type PeerConnectionEvent } from '../topology';
import { createMessage, isFederationMessage, type FederationEnvelope, type OfferPayload, type AnswerPayload, type IcePayload, type HeartbeatPayload } from '../message';
import { DataChannelManager, getChannelSpec, resolveChannelForMessage, type ChannelPurpose } from './data-channel';
import type { SignalingServer } from '../signaling';
import type { FederationTransport, TransportConfig } from '../transport';

export interface PeerConnectionConfig {
  peerId: string;
  remotePeerId: string;
  signaling: SignalingServer;
  iceServers: RTCIceServer[];
  onStateChange?: (state: PeerConnectionState) => void;
  onMessage?: (envelope: FederationEnvelope) => void;
  onError?: (error: Error) => void;
}

export class PeerConnectionManager {
  readonly localPeerId: string;
  readonly remotePeerId: string;

  private signaling: SignalingServer;
  private pc: RTCPeerConnection | null = null;
  private dcManager = new DataChannelManager();
  private state: PeerConnectionState = 'idle';
  private config: PeerConnectionConfig;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatSeq = 0;
  private missedHeartbeats = 0;
  private maxMissedHeartbeats = 3;
  private isOfferer = false;
  private maxReconnectAttempts = 5;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;

  constructor(config: PeerConnectionConfig) {
    this.config = config;
    this.localPeerId = config.peerId;
    this.remotePeerId = config.remotePeerId;
    this.signaling = config.signaling;
  }

  getState(): PeerConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return isConnected(this.state);
  }

  getDataChannelManager(): DataChannelManager {
    return this.dcManager;
  }

  async connectAsOfferer(): Promise<void> {
    this.isOfferer = true;
    this.transition('connect_requested');
    this.pc = this.createPeerConnection();

    const controlSpec = getChannelSpec('control');
    const dc = this.pc.createDataChannel(controlSpec.label, {
      ordered: controlSpec.ordered,
      maxRetransmits: controlSpec.maxRetransmits,
    });
    this.setupDataChannel(dc, 'control');

    for (const spec of [getChannelSpec('sync'), getChannelSpec('intent'), getChannelSpec('provenance'), getChannelSpec('stream')]) {
      const ch = this.pc.createDataChannel(spec.label, {
        ordered: spec.ordered,
        maxRetransmits: spec.maxRetransmits,
      });
      this.setupDataChannel(ch, spec.purpose);
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const envelope = createMessage('federation.offer', this.localPeerId, {
      sdp: JSON.stringify(offer),
      sessionId: `${this.localPeerId}:${this.remotePeerId}`,
    } satisfies OfferPayload, this.remotePeerId);

    this.signaling.send(this.remotePeerId, envelope);
    this.transition('offer_sent');

    this.signaling.register(`${this.localPeerId}:relay`, (msg) => {
      if (msg.senderId !== this.remotePeerId) return;
      this.handleRelayedMessage(msg).catch((err) => this.config.onError?.(err));
    });
  }

  async connectAsAnswerer(offerEnvelope: FederationEnvelope): Promise<void> {
    this.isOfferer = false;
    this.transition('connect_requested');
    this.pc = this.createPeerConnection();

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const envelope = createMessage('federation.ice', this.localPeerId, {
          candidate: JSON.stringify(event.candidate),
          sdpMid: event.candidate.sdpMid ?? '',
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        } satisfies IcePayload, this.remotePeerId);
        this.signaling.send(this.remotePeerId, envelope);
      }
    };

    this.pc.ondatachannel = (event) => {
      const purpose = this.inferChannelPurpose(event.channel.label);
      this.setupDataChannel(event.channel, purpose);
    };

    const offerPayload = offerEnvelope.payload as OfferPayload;
    const offer = new RTCSessionDescription(JSON.parse(offerPayload.sdp));
    await this.pc.setRemoteDescription(offer);

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    const envelope = createMessage('federation.answer', this.localPeerId, {
      sdp: JSON.stringify(answer),
      sessionId: offerPayload.sessionId,
    } satisfies AnswerPayload, this.remotePeerId);

    this.signaling.send(this.remotePeerId, envelope);
    this.transition('answer_sent');

    this.signaling.register(`${this.localPeerId}:relay`, (msg) => {
      if (msg.senderId !== this.remotePeerId) return;
      this.handleRelayedMessage(msg).catch((err) => this.config.onError?.(err));
    });
  }

  async disconnect(): Promise<void> {
    this.transition('disconnect_requested');
    this.stopHeartbeat();
    this.dcManager.closeAll();
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.signaling.unregister(`${this.localPeerId}:relay`);
    this.transition('disconnected');
  }

  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.onError?.(new Error(`Max reconnection attempts reached for ${this.remotePeerId}`));
      return;
    }
    this.reconnectAttempts++;
    await this.disconnect();
    await new Promise((r) => setTimeout(r, this.reconnectDelay * this.reconnectAttempts));
    if (this.isOfferer) {
      await this.connectAsOfferer();
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const envelope = createMessage('federation.ice', this.localPeerId, {
          candidate: JSON.stringify(event.candidate),
          sdpMid: event.candidate.sdpMid ?? '',
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        } satisfies IcePayload, this.remotePeerId);
        this.signaling.send(this.remotePeerId, envelope);
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.startHeartbeat();
          break;
        case 'disconnected':
        case 'failed':
          this.transition('heartbeat_timeout');
          break;
        case 'closed':
          this.transition('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.config.onError?.(new Error(`ICE connection failed with ${this.remotePeerId}`));
      }
    };

    return pc;
  }

  private setupDataChannel(dc: RTCDataChannel, purpose: ChannelPurpose): void {
    const spec = getChannelSpec(purpose);

    dc.onopen = () => {
      this.dcManager.registerChannel(purpose, {
        spec,
        send: (envelope) => {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify(envelope));
          }
        },
        isOpen: () => dc.readyState === 'open',
        onMessage: (handler) => {
          dc.onmessage = (event) => {
            try {
              const parsed = JSON.parse(event.data);
              if (isFederationMessage(parsed)) {
                handler(parsed);
              }
            } catch { /* skip malformed */ }
          };
        },
        close: () => dc.close(),
      });
    };

    dc.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (isFederationMessage(parsed)) {
          this.config.onMessage?.(parsed);
        }
      } catch { /* skip malformed */ }
    };

    dc.onerror = (err: Event) => {
      this.config.onError?.(new Error(`DataChannel error on ${this.remotePeerId}`));
    };
  }

  private async handleRelayedMessage(msg: FederationEnvelope): Promise<void> {
    if (!this.pc) return;

    switch (msg.type) {
      case 'federation.ice': {
        const payload = msg.payload as IcePayload;
        if (this.pc.remoteDescription || this.pc.currentRemoteDescription) {
          await this.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(payload.candidate)));
        }
        break;
      }
      case 'federation.answer': {
        const payload = msg.payload as AnswerPayload;
        const answer = new RTCSessionDescription(JSON.parse(payload.sdp));
        await this.pc.setRemoteDescription(answer);
        this.transition('answer_received');
        break;
      }
      case 'federation.heartbeat': {
        const payload = msg.payload as HeartbeatPayload;
        this.missedHeartbeats = 0;
        const pong = createMessage('federation.heartbeat', this.localPeerId, {
          sessionId: payload.sessionId,
          seq: payload.seq,
        } satisfies HeartbeatPayload, this.remotePeerId);
        this.signaling.send(this.remotePeerId, pong);
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatInterval = setInterval(() => {
      this.heartbeatSeq++;
      this.missedHeartbeats++;
      const envelope = createMessage('federation.heartbeat', this.localPeerId, {
        sessionId: `${this.localPeerId}:${this.remotePeerId}`,
        seq: this.heartbeatSeq,
      } satisfies HeartbeatPayload, this.remotePeerId);
      const sent = this.signaling.send(this.remotePeerId, envelope);
      if (!sent || this.missedHeartbeats > this.maxMissedHeartbeats) {
        this.transition('heartbeat_timeout');
        this.reconnect().catch((err) => this.config.onError?.(err));
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private transition(event: PeerConnectionEvent): void {
    try {
      this.state = transitionState(this.state, event);
      this.config.onStateChange?.(this.state);
    } catch (e) {
      this.config.onError?.(e as Error);
    }
  }

  private inferChannelPurpose(label: string): ChannelPurpose {
    const map: Record<string, ChannelPurpose> = {
      'usir-control': 'control',
      'usir-sync': 'sync',
      'usir-intent': 'intent',
      'usir-provenance': 'provenance',
      'usir-stream': 'stream',
    };
    return map[label] ?? 'control';
  }
}
