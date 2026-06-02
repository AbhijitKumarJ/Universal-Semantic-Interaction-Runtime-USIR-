import { describe, it, expect } from 'vitest';
import { TrustClassifier } from './trust-classifier';

function intent(type: string, confidence = 1) {
  return {
    type,
    intentId: 'test',
    timestamp: Date.now(),
    actor: { type: 'user' as const, id: 'u1' },
    confidence,
  };
}

describe('TrustClassifier', () => {
  const classifier = new TrustClassifier();

  it('classifies read-only intents as Tier 1', () => {
    const result = classifier.classify(intent('intent.information.explain'));
    expect(result.tier).toBe(1);
    expect(result.requiresApproval).toBe(false);
  });

  it('classifies reversible mutations as Tier 2', () => {
    const result = classifier.classify(intent('intent.manipulation.edit'));
    expect(result.tier).toBe(2);
  });

  it('Tier 2 requires approval below confidence threshold', () => {
    const high = classifier.classify(intent('intent.manipulation.edit'), 0.95);
    const low = classifier.classify(intent('intent.manipulation.edit'), 0.5);
    expect(high.requiresApproval).toBe(false);
    expect(low.requiresApproval).toBe(true);
  });

  it('classifies irreversible actions as Tier 3', () => {
    const result = classifier.classify(intent('intent.manipulation.delete'));
    expect(result.tier).toBe(3);
    expect(result.requiresApproval).toBe(true);
    expect(result.reversible).toBe(false);
  });

  it('classifyDelegatePlan returns max tier', () => {
    const plan = [intent('intent.information.explain'), intent('intent.manipulation.delete')];
    const result = classifier.classifyDelegatePlan(plan);
    expect(result.tier).toBe(3);
  });

  it('classifyDelegatePlan returns tier 1 for all-tier-1 plan', () => {
    const plan = [intent('intent.information.explain'), intent('intent.navigation.locate')];
    const result = classifier.classifyDelegatePlan(plan);
    expect(result.tier).toBe(1);
  });
});
