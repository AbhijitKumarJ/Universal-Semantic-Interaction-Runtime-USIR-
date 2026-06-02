import { describe, it, expect } from 'vitest';
import { buildFusedIntent, type PointingTarget, type ImplicitSignals } from './fused-intent';

describe('buildFusedIntent', () => {
  it('builds a fused intent with all fields', () => {
    const target: PointingTarget = { entityId: 'e1', confidence: 1, dwellTimeMs: 200 };
    const signals: ImplicitSignals = { typingCadence: 'idle', cursorDwellTimeMs: 0 };
    const result = buildFusedIntent({
      linguisticInput: 'open file',
      pointingTarget: target,
      implicitSignals: signals,
      sources: ['voice', 'mouse'],
    });
    expect(result.linguisticInput).toBe('open file');
    expect(result.pointingTarget?.entityId).toBe('e1');
    expect(result.sources).toEqual(['voice', 'mouse']);
    expect(result.fusionConfidence).toBe(1.0);
    expect(typeof result.fusedAt).toBe('number');
  });

  it('defaults to null pointing target', () => {
    const result = buildFusedIntent({
      linguisticInput: 'hello',
      pointingTarget: null,
      implicitSignals: {},
      sources: ['text'],
    });
    expect(result.pointingTarget).toBeNull();
  });

  it('accepts custom fusion confidence', () => {
    const result = buildFusedIntent({
      linguisticInput: 'maybe?',
      pointingTarget: null,
      implicitSignals: {},
      sources: ['voice'],
      fusionConfidence: 0.5,
    });
    expect(result.fusionConfidence).toBe(0.5);
  });
});
