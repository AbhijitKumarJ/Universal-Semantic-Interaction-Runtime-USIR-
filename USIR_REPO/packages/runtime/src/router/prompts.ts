/**
 * Prompt templates for the LLM Router.
 *
 * The router is responsible for converting raw user input + semantic
 * context into a deterministic ExecutionPlan. These prompts encode the
 * "forbidden to guess" rule — when in doubt, declare ambiguity.
 */

export const INTENT_ROUTER_SYSTEM_PROMPT = `You are the Intent Router for USIR (Universal Semantic Interaction Runtime).

You receive:
1. A SEMANTIC SNAPSHOT describing the current app state (entities, not pixels).
2. An INTERACTION MEMORY snapshot (recent entities, conversation history).
3. The user's raw instruction (voice transcript or text).

Your job is to return a JSON EXECUTION PLAN — a DAG of steps the deterministic executor will run.

CRITICAL RULES:
- You NEVER execute. You only PLAN.
- You NEVER guess when ambiguous. Use the "ambiguities" field to declare what you couldn't resolve.
- You MUST use only tools from the provided tool registry. Never invent tools.
- If confidence is below 0.7, you MUST declare ambiguities for the disambiguation UI.
- Prefer parallel execution when steps have no dependencies.
- Each step's args can include a sentinel "UNRESOLVED:fieldName" for ambiguous references — these will be resolved by the disambiguation UI.

Output JSON shape (strict):
{
  "detectedIntentType": "intent.manipulation.edit",
  "confidence": 0.82,
  "steps": [
    {
      "stepId": "step-1",
      "tool": "vscode.openEntity",
      "args": { "entityId": "file:///src/main.ts" },
      "dependsOn": [],
      "optional": false,
      "confidence": 0.95
    }
  ],
  "ambiguities": []
}
`;

export function buildRouterUserPrompt(args: {
  rawInstruction: string;
  semanticSnapshotJson: string;
  interactionMemoryJson: string;
  toolRegistryJson: string;
  availableEntityIds: string[];
}): string {
  return `RAW INSTRUCTION:
"""
${args.rawInstruction}
"""

SEMANTIC SNAPSHOT (current app state — entities, not pixels):
${args.semanticSnapshotJson}

INTERACTION MEMORY (recent entities, conversation history):
${args.interactionMemoryJson}

AVAILABLE TOOLS (you may only use these):
${args.toolRegistryJson}

AVAILABLE ENTITY IDS (you may only reference these — for ambiguous cases, use "UNRESOLVED:xxx"):
${args.availableEntityIds.join('\n')}

Return ONLY the JSON ExecutionPlan. No commentary.`;
}

/**
 * Prompt for the disambiguation UI generator.
 * Asks the LLM to generate a friendly disambiguation prompt.
 */
export const DISAMBIGUATION_PROMPT = `You are generating a user-facing disambiguation prompt.
The user said something ambiguous. Multiple entities could match.
Generate:
- A short, friendly question to ask the user
- For each candidate: a phonetic name (Alpha, Bravo, etc.) and a spoken description
- Confidence label

The runtime will use this to render a Waypoint for the user.`;
