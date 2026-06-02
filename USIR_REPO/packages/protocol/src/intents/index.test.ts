import { describe, it, expect } from 'vitest';
import { getIntentLayer, isMutatingIntent, isReversibleIntent } from './index';

function makeIntent(type: string) {
  return {
    type,
    intentId: 'test',
    timestamp: Date.now(),
    actor: { type: 'user' as const, id: 'user-1' },
    confidence: 1,
  };
}

describe('getIntentLayer', () => {
  it('returns 0 for meta intents', () => {
    expect(getIntentLayer(makeIntent('intent.meta.cancel'))).toBe(0);
    expect(getIntentLayer(makeIntent('intent.meta.undo'))).toBe(0);
  });

  it('returns 1 for navigation intents', () => {
    expect(getIntentLayer(makeIntent('intent.navigation.locate'))).toBe(1);
    expect(getIntentLayer(makeIntent('intent.navigation.open'))).toBe(1);
  });

  it('returns 2 for attention intents', () => {
    expect(getIntentLayer(makeIntent('intent.attention.focus'))).toBe(2);
    expect(getIntentLayer(makeIntent('intent.attention.select'))).toBe(2);
  });

  it('returns 3 for information intents', () => {
    expect(getIntentLayer(makeIntent('intent.information.explain'))).toBe(3);
    expect(getIntentLayer(makeIntent('intent.information.search'))).toBe(3);
  });

  it('returns 4 for manipulation intents', () => {
    expect(getIntentLayer(makeIntent('intent.manipulation.edit'))).toBe(4);
    expect(getIntentLayer(makeIntent('intent.manipulation.delete'))).toBe(4);
  });

  it('returns 4 for creation intents (under manipulation layer)', () => {
    expect(getIntentLayer(makeIntent('intent.manipulation.create'))).toBe(4);
  });

  it('returns 6 for execution intents', () => {
    expect(getIntentLayer(makeIntent('intent.execution.run'))).toBe(6);
  });

  it('returns 7 for delegation intents', () => {
    expect(getIntentLayer(makeIntent('intent.delegation.plan'))).toBe(7);
  });

  it('returns 8 for collaboration intents', () => {
    expect(getIntentLayer(makeIntent('intent.collaboration.share'))).toBe(8);
  });
});

describe('isMutatingIntent', () => {
  it('returns false for non-mutating layers', () => {
    expect(isMutatingIntent(makeIntent('intent.navigation.locate'))).toBe(false);
    expect(isMutatingIntent(makeIntent('intent.information.explain'))).toBe(false);
  });

  it('returns true for manipulation intents', () => {
    expect(isMutatingIntent(makeIntent('intent.manipulation.edit'))).toBe(true);
    expect(isMutatingIntent(makeIntent('intent.manipulation.delete'))).toBe(true);
  });

  it('returns true for creation intents', () => {
    expect(isMutatingIntent(makeIntent('intent.manipulation.create'))).toBe(true);
  });
});

describe('isReversibleIntent', () => {
  it('returns true for most intents', () => {
    expect(isReversibleIntent(makeIntent('intent.manipulation.edit'))).toBe(true);
    expect(isReversibleIntent(makeIntent('intent.navigation.open'))).toBe(true);
  });

  it('returns false for delete', () => {
    expect(isReversibleIntent(makeIntent('intent.manipulation.delete'))).toBe(false);
  });

  it('returns false for execution.run', () => {
    expect(isReversibleIntent(makeIntent('intent.execution.run'))).toBe(false);
  });

  it('returns false for collaboration.share', () => {
    expect(isReversibleIntent(makeIntent('intent.collaboration.share'))).toBe(false);
  });
});
