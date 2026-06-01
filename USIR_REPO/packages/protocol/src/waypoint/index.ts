/**
 * Interaction Waypoint — the multi-modal interaction primitive.
 *
 * This is the unit of presentation that flows over the wire. The runtime
 * doesn't know whether it's rendered as a button, a voice prompt, or a
 * 3D hologram. It just hands the Waypoint to the active surface.
 *
 * Adapted from the original XML spec in usir.json Batch 1, with the
 * `<Fallback>` node added per the first review's critique.
 */

import type { CognitiveReference } from '../memory';

export interface InteractionWaypoint {
  id: string;
  context: {
    state: string;
    objective: string;
  };

  /** How this waypoint is presented across modalities */
  presentations: Presentations;

  /** How the user can respond */
  expectedInputs: ExpectedInputs;

  /**
   * Fallback chain when the device supports none of the declared modalities.
   * Reviewed as critical missing piece — every Waypoint MUST specify this.
   */
  fallback: FallbackChain;

  /** Optional: provenance pointer for this waypoint */
  provenanceId?: string;
}

export interface Presentations {
  display?: DisplayPresentation;
  audio?: AudioPresentation;
  spatial?: SpatialPresentation;
  haptic?: HapticPresentation;
  /** XR-specific floating panel */
  xr?: XrPresentation;
}

export interface DisplayPresentation {
  layout: 'wizard_list' | 'info_card' | 'form_input' | 'diff_review' | 'modal' | 'inline';
  html?: string;
  prompt?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  /** Confidence label for disambiguation */
  confidence?: { value: number; label: string };
  primaryAction?: { label: string; action: string };
  secondaryAction?: { label: string; action: string };
  tertiaryAction?: { label: string; action: string };
}

export interface AudioPresentation {
  /** Text-to-speech content */
  tts: string;
  /** SSML markup if available */
  ssml?: string;
  /** Auto-play (default false — user may be in a meeting) */
  autoPlay?: boolean;
  /** Optional earcon (beep/chime) for start/end of utterance */
  earcon?: { type: string; at: 'start' | 'end' };
}

export interface SpatialPresentation {
  layout: 'floating_panel' | 'ground_plane' | 'head_locked' | 'world_locked';
  position?: 'center_eye_level' | 'left' | 'right' | 'top' | 'bottom';
  content: string;
  /** Anchor to a real-world entity */
  anchorToEntityId?: string;
}

export interface HapticPresentation {
  pattern: 'attention_single' | 'attention_double' | 'notification_double' | 'success' | 'error' | 'custom';
  timing: 'immediate' | 'deferred';
  repeat?: boolean;
}

export interface XrPresentation {
  layout: 'floating_panel' | 'holographic_button' | 'spatial_annotation';
  position: { x: number; y: number; z: number };
  content3D: string;
  /** Holographic button (e.g. "Skip") */
  holoButtons?: Array<{ id: string; label: string }>;
}

export interface ExpectedInputs {
  voice?: VoiceInput;
  touch?: TouchInput;
  gesture?: GestureInput;
  /** Watch crown / dial */
  dial?: DialInput;
}

export interface VoiceInput {
  /** Free-form grammar */
  grammar?: {
    type: 'constrained' | 'open' | 'hybrid';
    phrases?: Array<{ utterances: string[]; action: string }>;
  };
  /** Specific intent that voice should generate */
  intents?: Array<{ utterances: string[]; intentType: string }>;
}

export interface TouchInput {
  events: Array<{ target: string; action: string }>;
}

export interface GestureInput {
  actions: Array<{ type: 'pinch' | 'swipe' | 'nod' | 'thumbs_up' | 'wave' | 'point'; target?: string; action: string }>;
}

export interface DialInput {
  rotations: Array<{ direction: 'cw' | 'ccw'; steps?: number; action: string }>;
  presses: Array<{ duration: 'short' | 'long'; action: string }>;
}

/**
 * Fallback chain for capability-zero devices.
 * Critical: every Waypoint must specify at least one fallback.
 */
export type FallbackChannel = 'sms' | 'email' | 'push' | 'usb' | 'qr' | 'voice_call';

export interface FallbackChain {
  /** Ordered list of fallback channels */
  channels: Array<{
    channel: FallbackChannel;
    /** TTS-speakable summary for phone calls */
    spokenSummary?: string;
    /** URL for QR fallback */
    url?: string;
    /** Body for SMS/email */
    body?: string;
  }>;
  /** Maximum time to wait for primary modality response before fallback */
  timeoutMs: number;
  /** What to do if all fallbacks also fail */
  onExhaustion: 'defer' | 'queue' | 'discard';
}

// ─────────────────────────────────────────────────────────────────────────────
// Waypoint builders
// ─────────────────────────────────────────────────────────────────────────────

export function buildSimpleWaypoint(
  id: string,
  state: string,
  objective: string,
  prompt: string,
  options: Array<{ id: string; label: string }>,
  intentForOption: (optionId: string) => string,
): InteractionWaypoint {
  return {
    id,
    context: { state, objective },
    presentations: {
      display: {
        layout: 'wizard_list',
        prompt,
        options,
      },
      audio: {
        tts: `${prompt} ${options.map((o) => o.label).join(', or ')}.`,
      },
    },
    expectedInputs: {
      voice: {
        intents: options.map((o) => ({
          utterances: [o.label.toLowerCase(), o.id],
          intentType: intentForOption(o.id),
        })),
      },
      touch: {
        events: options.map((o) => ({ target: o.id, action: intentForOption(o.id) })),
      },
    },
    fallback: {
      channels: [
        {
          channel: 'sms',
          body: `${prompt}\n\nReply with: ${options.map((o) => o.label).join(' / ')}`,
        },
      ],
      timeoutMs: 60_000,
      onExhaustion: 'queue',
    },
  };
}
