/**
 * BMAD Wizard — Example PoC using USIR.
 *
 * The BMAD (Background, Mission, Action, Decision) brainstorming wizard
 * is the canonical example from the original conversation. This script
 * demonstrates how to build a multi-step guided flow using InteractionWaypoints.
 *
 * Run with: npx ts-node examples/bmad-wizard/wizard.ts
 */

import {
  buildSimpleWaypoint,
  createEntity,
  type InteractionWaypoint,
  type SemanticEntity,
  type SemanticSnapshot,
  createEmptyHotSnapshot,
} from '../../USIR_REPO/packages/protocol/src';

function buildBmadSession(): InteractionWaypoint[] {
  // Step 1: Background — gather context
  const step1 = buildSimpleWaypoint(
    'bmad_step_1_background',
    'bmad_background',
    'Set the context for brainstorming',
    'Let\'s start with the background. What problem are you trying to solve?',
    [
      { id: 'tech_problem', label: 'A technical problem' },
      { id: 'business_problem', label: 'A business problem' },
      { id: 'design_problem', label: 'A design problem' },
      { id: 'other', label: 'Something else' },
    ],
    (optionId) => `intent.manipulation.create:${optionId}`,
  );

  // Step 2: Mission — define the goal
  const step2 = buildSimpleWaypoint(
    'bmad_step_2_mission',
    'bmad_mission',
    'Define the mission of this brainstorming session',
    'What does success look like? In one sentence, what outcome are you aiming for?',
    [
      { id: 'short_term', label: 'A short-term fix (this week)' },
      { id: 'medium_term', label: 'A medium-term solution (this quarter)' },
      { id: 'long_term', label: 'A long-term vision (this year)' },
    ],
    (optionId) => `intent.manipulation.create:${optionId}`,
  );

  // Step 3: Action — diverge on ideas
  const step3 = buildSimpleWaypoint(
    'bmad_step_3_diverge',
    'bmad_diverge',
    'Diverge on as many ideas as possible',
    'Now, let\'s diverge. Speak or type as many ideas as you can. I\'ll capture them. When you\'re done, say "next".',
    [
      { id: 'next', label: 'I have more ideas — continue' },
      { id: 'converge', label: 'Done — let\'s converge' },
    ],
    (optionId) => `intent.manipulation.create:${optionId}`,
  );

  return [step1, step2, step3];
}

function exampleSnapshot(): SemanticSnapshot {
  const activeEntity = createEntity({
    id: 'session://bmad-wizard-1',
    role: 'task',
    displayName: 'BMAD Wizard Session',
    attributes: { step: 1, mode: 'background' },
  });
  return {
    hot: createEmptyHotSnapshot(activeEntity, 'wizard'),
    warm: {
      tier: 'warm',
      visible: [activeEntity],
      recentlyChanged: [],
      panelLayout: [],
      capturedAt: Date.now(),
      latencyBudgetMs: 150,
    },
    cold: undefined,
    source: 'example',
    version: 1,
    assembledAt: Date.now(),
  };
}

// Demo
if (require.main === module) {
  console.log('=== USIR BMAD Wizard PoC ===\n');
  const waypoints = buildBmadSession();
  for (const waypoint of waypoints) {
    console.log(`Step: ${waypoint.context.state}`);
    console.log(`  Objective: ${waypoint.context.objective}`);
    console.log(`  Display prompt: ${waypoint.presentations.display?.prompt}`);
    console.log(`  TTS: ${waypoint.presentations.audio?.tts}`);
    console.log(`  Fallback: ${waypoint.fallback.channels[0]?.channel}`);
    console.log('');
  }
  const snap = exampleSnapshot();
  console.log('Example snapshot:');
  console.log(`  Active entity: ${snap.hot.activeEntity.displayName}`);
  console.log(`  Hot tier latency budget: ${snap.hot.latencyBudgetMs}ms`);
  console.log(`  Warm tier entities visible: ${snap.warm.visible.length}`);
}

export { buildBmadSession, exampleSnapshot };
