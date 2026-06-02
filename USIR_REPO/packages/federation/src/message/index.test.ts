import { describe, it, expect } from 'vitest';
import {
  createMessage,
  isFederationMessage,
  type OfferPayload,
  type JoinPayload,
  type HeartbeatPayload,
  type SyncPayload,
} from './index';

describe('FederationMessage', () => {
  it('creates an offer message', () => {
    const msg = createMessage('federation.offer', 'peer-a', {
      sdp: 'v=0...',
      sessionId: 'a:b',
    } satisfies OfferPayload, 'peer-b');

    expect(msg.type).toBe('federation.offer');
    expect(msg.senderId).toBe('peer-a');
    expect(msg.targetId).toBe('peer-b');
    expect(msg.messageId).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('creates a join message', () => {
    const msg = createMessage('federation.join', 'peer-a', {
      peer: { peerId: 'peer-a', displayName: 'Alpha', runtimeVersion: '0.1.0' },
      capabilities: { supportedRoles: ['function'], supportedLayers: [1, 2], supportedIntents: [] },
    } satisfies JoinPayload);

    expect(msg.type).toBe('federation.join');
    expect(msg.targetId).toBeUndefined();
  });

  it('creates a heartbeat message', () => {
    const msg = createMessage('federation.heartbeat', 'peer-a', {
      sessionId: 'a:b',
      seq: 1,
    } satisfies HeartbeatPayload, 'peer-b');

    const payload = msg.payload as HeartbeatPayload;
    expect(payload.seq).toBe(1);
    expect(payload.sessionId).toBe('a:b');
  });

  it('validates a well-formed message', () => {
    const msg = createMessage('federation.sync', 'peer-a', {
      baseVersion: 0,
      targetVersion: 1,
      patches: [],
    } satisfies SyncPayload);
    expect(isFederationMessage(msg)).toBe(true);
  });

  it('rejects non-message objects', () => {
    expect(isFederationMessage(null)).toBe(false);
    expect(isFederationMessage({})).toBe(false);
    expect(isFederationMessage({ messageId: 'm1' })).toBe(false);
  });
});
