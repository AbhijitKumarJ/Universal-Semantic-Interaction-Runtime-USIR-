import { describe, it, expect } from 'vitest';
import { createPeer } from './index';

describe('FederationPeer', () => {
  it('creates a peer with required fields', () => {
    const peer = createPeer({ peerId: 'peer-1', displayName: 'Runtime A' });
    expect(peer.peerId).toBe('peer-1');
    expect(peer.displayName).toBe('Runtime A');
    expect(peer.runtimeVersion).toBe('0.1.0');
    expect(peer.status).toBe('online');
    expect(peer.trustLevel).toBe('anonymous');
  });

  it('merges partial overrides', () => {
    const peer = createPeer({
      peerId: 'peer-2',
      displayName: 'Runtime B',
      trustLevel: 'known',
      status: 'busy',
    });
    expect(peer.trustLevel).toBe('known');
    expect(peer.status).toBe('busy');
    expect(peer.addresses).toEqual([]);
  });
});
