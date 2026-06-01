/**
 * FusedIntent — combines linguistic + pointing + implicit signals.
 *
 * A pure voice command is one thing. A voice command while pointing
 * at a specific UI region is much more powerful. The FusedIntent is
 * the runtime's input primitive: "what they said" + "what they're
 * looking at" + "their cognitive state".
 *
 * The Implicit Modality (typing cadence, dwell time) is the third
 * channel added in the Semantic Horizon expansion.
 */

export interface PointingTarget {
  entityId: string;
  /** Spatial bounds at the moment of the command */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Confidence that this is what the user is pointing at */
  confidence: number;
  /** How long the user has been pointing here (ms) */
  dwellTimeMs: number;
}

export interface ImplicitSignals {
  /** Typing cadence pattern (flow / erratic / halted) */
  typingCadence?: 'flow' | 'erratic' | 'halted' | 'idle';
  /** Cursor dwell time on current entity */
  cursorDwellTimeMs?: number;
  /** Recent edit frequency — proxy for "in the zone" */
  editsPerMinute?: number;
  /** Last user expression of frustration/confusion */
  affectiveMarker?: 'confused' | 'frustrated' | 'focused' | 'curious';
  /** Physiological (wearable-derived) — gaze stability, blink rate */
  gazeStabilityScore?: number;
  /** Time since last interaction (ms) — proxy for "stuck" */
  timeSinceLastInteractionMs?: number;
}

export interface FusedIntent {
  /** Raw text instruction (from voice or typed) */
  linguisticInput: string;
  /** What the user is pointing at (mouse, gaze, touch) */
  pointingTarget: PointingTarget | null;
  /** Passive cognitive signals (typed cadence, gaze, etc.) */
  implicitSignals: ImplicitSignals;
  /** When the intent was fused (epoch ms) */
  fusedAt: number;
  /** Which surfaces contributed (voice mic, gaze tracker, keyboard) */
  sources: Array<'voice' | 'text' | 'gaze' | 'mouse' | 'touch' | 'wearable'>;
  /** Optional audio fingerprint of the speaker for personalization */
  speakerId?: string;
  /** Confidence the fusion is correct (e.g. low if voice quality is poor) */
  fusionConfidence: number;
}

/**
 * Build a FusedIntent from raw input streams. Used by the audio pipeline
 * before handing off to the LLM router.
 */
export function buildFusedIntent(args: {
  linguisticInput: string;
  pointingTarget: PointingTarget | null;
  implicitSignals: ImplicitSignals;
  sources: FusedIntent['sources'];
  speakerId?: string;
  fusionConfidence?: number;
}): FusedIntent {
  return {
    linguisticInput: args.linguisticInput,
    pointingTarget: args.pointingTarget,
    implicitSignals: args.implicitSignals,
    sources: args.sources,
    speakerId: args.speakerId,
    fusedAt: Date.now(),
    fusionConfidence: args.fusionConfidence ?? 1.0,
  };
}
