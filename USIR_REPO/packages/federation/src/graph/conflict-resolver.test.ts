import { describe, it, expect } from 'vitest';
import { ConflictResolver } from './conflict-resolver';

describe('ConflictResolver', () => {
  const resolver = new ConflictResolver({
    priorityIntentTypes: ['intent.collaboration.share'],
    authorityPeerIds: ['peer-admin'],
    preferLocal: true,
  });

  it('resolves node_changed with local preference by default', () => {
    const result = resolver.resolve(
      { type: 'node_changed', entityId: 'e1' },
      'peer-a',
      'peer-b',
    );
    expect(result.winnerPeerId).toBe('peer-a');
    expect(result.strategy).toBe('lww');
  });

  it('gives priority to intent_priority when intent matches', () => {
    const result = resolver.resolve(
      { type: 'node_changed', entityId: 'e1' },
      'peer-a',
      'peer-b',
      'intent.collaboration.share',
    );
    expect(result.strategy).toBe('intent_priority');
    expect(result.winnerPeerId).toBe('peer-b');
  });

  it('authority peers win over locals', () => {
    const result = resolver.resolve(
      { type: 'node_changed', entityId: 'e1' },
      'peer-a',
      'peer-admin',
    );
    expect(result.strategy).toBe('authority_wins');
    expect(result.winnerPeerId).toBe('peer-admin');
  });

  it('shouldAcceptRemoteChange returns true for LWW (Yjs handles merge)', () => {
    const result = resolver.resolve(
      { type: 'node_changed', entityId: 'e1' },
      'peer-a',
      'peer-b',
    );
    expect(resolver.shouldAcceptRemoteChange(result, 'peer-a')).toBe(true);
  });

  it('shouldAcceptRemoteChange returns true when authority_wins favors remote', () => {
    const resolver2 = new ConflictResolver({
      priorityIntentTypes: [],
      authorityPeerIds: ['peer-b'],
      preferLocal: false,
    });

    const result = resolver2.resolve(
      { type: 'node_changed', entityId: 'e1' },
      'peer-a',
      'peer-b',
    );
    expect(resolver2.shouldAcceptRemoteChange(result, 'peer-a')).toBe(true);
  });
});
