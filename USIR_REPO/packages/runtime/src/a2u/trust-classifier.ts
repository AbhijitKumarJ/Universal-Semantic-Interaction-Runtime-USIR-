/**
 * A2U (Agent-to-USIR) Trust Classifier.
 *
 * The A2U protocol keeps the human meaningfully in control of agents
 * they aren't watching. This is the trust tier gate.
 *
 * Tier 1: read-only, agent can do without asking
 * Tier 2: reversible mutations, checkpoint on low confidence
 * Tier 3: irreversible or high-impact, always requires approval
 */

import type { BaseIntent, IntentEnvelope } from '@usir/protocol/intents';
import type { DelegateIntent } from '@usir/protocol/intents';

export interface TrustTier {
  tier: 1 | 2 | 3;
  requiresApproval: boolean;
  logToProvenance: boolean;
  reversible: boolean;
}

const CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE = 0.85;

export class TrustClassifier {
  classify(intent: BaseIntent, agentConfidence?: number): TrustTier {
    const conf = agentConfidence ?? 1.0;
    switch (intent.type) {
      // Tier 1 — read-only
      case 'intent.information.explain':
      case 'intent.information.summarize':
      case 'intent.information.compare':
      case 'intent.information.search':
      case 'intent.navigation.locate':
      case 'intent.attention.focus':
      case 'intent.attention.highlight':
        return { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };

      // Tier 2 — reversible mutations
      case 'intent.manipulation.edit':
      case 'intent.manipulation.move':
      case 'intent.manipulation.create':
        return {
          tier: 2,
          requiresApproval: conf < CONFIDENCE_THRESHOLD_FOR_AUTO_APPROVE,
          logToProvenance: true,
          reversible: true,
        };

      // Tier 3 — irreversible or high-impact
      case 'intent.manipulation.delete':
      case 'intent.execution.run':
      case 'intent.execution.schedule':
      case 'intent.collaboration.share':
      case 'intent.collaboration.broadcast':
        return { tier: 3, requiresApproval: true, logToProvenance: true, reversible: false };

      default:
        // Default to Tier 2 with approval required
        return { tier: 2, requiresApproval: true, logToProvenance: true, reversible: true };
    }
  }

  /**
   * Classify a delegate intent's worth of sub-steps.
   * Returns the maximum trust tier required.
   */
  classifyDelegatePlan(intents: BaseIntent[]): TrustTier {
    let max: TrustTier = { tier: 1, requiresApproval: false, logToProvenance: true, reversible: true };
    for (const intent of intents) {
      const tier = this.classify(intent);
      if (tier.tier > max.tier) max = tier;
    }
    return max;
  }
}
