import { describe, it, expect } from 'vitest';
import { transitionState, isConnected } from './index';

describe('FederationTopology', () => {
  it('starts at idle and transitions to connecting', () => {
    const next = transitionState('idle', 'connect_requested');
    expect(next).toBe('connecting');
  });

  it('transitions connecting → awaiting_answer on offer_sent', () => {
    const next = transitionState('connecting', 'offer_sent');
    expect(next).toBe('awaiting_answer');
  });

  it('transitions awaiting_answer → connected on answer_received', () => {
    const next = transitionState('awaiting_answer', 'answer_received');
    expect(next).toBe('connected');
  });

  it('transitions connected → syncing on sync_started', () => {
    const next = transitionState('connected', 'sync_started');
    expect(next).toBe('syncing');
  });

  it('transitions syncing → synced on sync_completed', () => {
    const next = transitionState('syncing', 'sync_completed');
    expect(next).toBe('synced');
  });

  it('transitions any state → error on error_occurred', () => {
    expect(transitionState('connected', 'error_occurred')).toBe('error');
    expect(transitionState('syncing', 'error_occurred')).toBe('error');
    expect(transitionState('connecting', 'error_occurred')).toBe('error');
  });

  it('recovers from error back to connecting', () => {
    const next = transitionState('error', 'connect_requested');
    expect(next).toBe('connecting');
  });

  it('throws on invalid transitions', () => {
    expect(() => transitionState('idle', 'answer_received')).toThrow('Invalid transition');
    expect(() => transitionState('idle', 'sync_completed')).toThrow('Invalid transition');
  });

  it('isConnected returns true for connected/syncing/synced', () => {
    expect(isConnected('connected')).toBe(true);
    expect(isConnected('syncing')).toBe(true);
    expect(isConnected('synced')).toBe(true);
    expect(isConnected('idle')).toBe(false);
    expect(isConnected('error')).toBe(false);
  });
});
