/**
 * Collaborative Narrowing — the disambiguation paradigm.
 *
 * The "handshake" pattern: when the LLM cannot resolve a target uniquely,
 * we highlight all candidates in the UI, give them phonetic names, and
 * let the user drill down. Ambiguity is a feature, not an error.
 */

import type { SemanticEntity } from '@usir/protocol/entities';
import type { Ambiguity, BaseIntent } from '@usir/protocol/intents';
import type { InteractionWaypoint } from '@usir/protocol/waypoint';

const PHONETIC_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
  'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
  'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo',
  'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray',
  'Yankee', 'Zulu',
];

export interface Tool {
  name: string;
  description: string;
  /** Execute the tool with resolved args */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public list(): Tool[] {
    return Array.from(this.tools.values());
  }

  public toJSON(): Array<{ name: string; description: string }> {
    return this.list().map((t) => ({ name: t.name, description: t.description }));
  }
}

/**
 * Assign phonetic names to candidate entities.
 * Stable: same entity id always gets the same phonetic name within a session.
 */
export function assignPhoneticNames(entities: SemanticEntity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < entities.length && i < PHONETIC_NAMES.length; i++) {
    map.set(entities[i]!.id, PHONETIC_NAMES[i]!);
  }
  return map;
}

/**
 * Build the disambiguation Waypoint that the surface will render.
 *
 * The Waypoint carries everything needed: which entities to highlight,
 * what to call them, what to say aloud, and the fallback chain for
 * capability-zero devices.
 */
export function buildDisambiguationWaypoint(args: {
  waypointId: string;
  rawInstruction: string;
  candidates: SemanticEntity[];
  /** Optional pre-computed context for the user */
  contextHint?: string;
}): InteractionWaypoint {
  const { waypointId, rawInstruction, candidates, contextHint } = args;
  const phonetic = assignPhoneticNames(candidates);

  const options = candidates.map((e) => ({
    id: e.id,
    label: `${phonetic.get(e.id)} — ${e.displayName}`,
    description: e.context ? JSON.stringify(e.context) : undefined,
  }));

  // TTS-speakable summary
  const tts = `I found ${candidates.length} matches for "${rawInstruction}". ${
    candidates.map((e, i) => `${phonetic.get(e.id)}: ${e.displayName}`).join('; ')
  }. Which one?`;

  return {
    id: waypointId,
    context: {
      state: 'disambiguation',
      objective: `Resolve: ${rawInstruction}`,
    },
    presentations: {
      display: {
        layout: 'wizard_list',
        prompt: contextHint ? `${contextHint}\n\n"${rawInstruction}"` : `"${rawInstruction}"`,
        options,
      },
      audio: {
        tts,
        autoPlay: true,
      },
      haptic: {
        pattern: 'attention_double',
        timing: 'immediate',
      },
      spatial: {
        layout: 'floating_panel',
        position: 'center_eye_level',
        content: tts,
      },
    },
    expectedInputs: {
      voice: {
        intents: options.map((o) => ({
          utterances: [o.label.split(' — ')[0]!.toLowerCase(), o.id],
          intentType: 'intent.attention.select',
        })),
      },
      touch: {
        events: options.map((o) => ({ target: o.id, action: 'intent.attention.select' })),
      },
      gesture: {
        actions: [
          { type: 'point', target: candidates[0]?.id, action: 'intent.attention.select' },
        ],
      },
    },
    fallback: {
      channels: [
        {
          channel: 'sms',
          body: `Pick one: ${options.map((o) => o.label).join(' | ')}`,
        },
      ],
      timeoutMs: 60_000,
      onExhaustion: 'queue',
    },
  };
}

/**
 * Convert an Ambiguity declaration from the LLM plan into a Waypoint.
 */
export function ambiguityToWaypoint(ambiguity: Ambiguity, candidates: SemanticEntity[]): InteractionWaypoint {
  return buildDisambiguationWaypoint({
    waypointId: `disambiguate-${Date.now()}`,
    rawInstruction: ambiguity.question,
    candidates,
  });
}
