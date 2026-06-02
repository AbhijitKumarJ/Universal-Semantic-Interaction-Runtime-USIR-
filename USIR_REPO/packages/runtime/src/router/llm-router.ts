/**
 * LLM Router — converts raw user input + semantic context into an ExecutionPlan.
 *
 * The router is the only place in the runtime that talks to an LLM.
 * It is intentionally simple: assemble a prompt, call the LLM, validate
 * the JSON output, and pass it to the executor.
 */

import type { BaseIntent, IntentEnvelope } from '@usir/protocol/intents';
import type { SemanticSnapshot } from '@usir/protocol/snapshot';
import type { InteractionMemorySnapshot } from '@usir/protocol/memory';
import type { ExecutionPlan, ExecutionStep } from './types';
import { INTENT_ROUTER_SYSTEM_PROMPT, buildRouterUserPrompt } from './prompts';

export interface LLMRouterConfig {
  /** LLM provider endpoint */
  endpoint: string;
  /** API key for the LLM provider */
  apiKey: string;
  /** Model to use (e.g. "gpt-4o", "claude-3-5-sonnet", "llama-3.1-70b") */
  model: string;
  /** Temperature (0 recommended for deterministic plans) */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
}

export interface LLMRouterDeps {
  config: LLMRouterConfig;
  /** Function to fetch the current tool registry as JSON */
  getToolRegistryJson: () => Promise<string>;
  /** Function to fetch all currently-known entity ids */
  getAvailableEntityIds: () => Promise<string[]>;
}

export class LLMRouter {
  constructor(private deps: LLMRouterDeps) {}

  /**
   * Route a raw user instruction into an ExecutionPlan.
   * Throws if the LLM returns invalid JSON or the plan fails validation.
   */
  public async route(args: {
    rawInstruction: string;
    snapshot: SemanticSnapshot;
    memory: InteractionMemorySnapshot;
  }): Promise<ExecutionPlan> {
    const [toolRegistryJson, availableEntityIds] = await Promise.all([
      this.deps.getToolRegistryJson(),
      this.deps.getAvailableEntityIds(),
    ]);

    const userPrompt = buildRouterUserPrompt({
      rawInstruction: args.rawInstruction,
      semanticSnapshotJson: JSON.stringify(this.stripHotSnapshotForPrompt(args.snapshot), null, 2),
      interactionMemoryJson: JSON.stringify(args.memory, null, 2),
      toolRegistryJson,
      availableEntityIds,
    });

    const response = await this.callLLM([
      { role: 'system', content: INTENT_ROUTER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = this.parseAndValidate(response, args.rawInstruction);
    return parsed;
  }

  private async callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
    // OpenAI-compatible call. Adapt for other providers as needed.
    const res = await fetch(`${this.deps.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deps.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.deps.config.model,
        messages,
        temperature: this.deps.config.temperature ?? 0,
        max_tokens: this.deps.config.maxTokens ?? 4000,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    return data.choices[0].message.content as string;
  }

  private parseAndValidate(raw: string, rawInstruction: string): ExecutionPlan {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`LLM returned invalid JSON: ${err}`, { cause: err });
    }
    // Basic validation — real impl would use Zod
    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error('LLM plan missing steps array');
    }
    if (typeof parsed.confidence !== 'number') {
      throw new Error('LLM plan missing confidence');
    }
    if (typeof parsed.detectedIntentType !== 'string') {
      throw new Error('LLM plan missing detectedIntentType');
    }
    return {
      planId: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      rawInstruction,
      steps: parsed.steps as ExecutionStep[],
      ambiguities: parsed.ambiguities ?? [],
      confidence: parsed.confidence,
      detectedIntentType: parsed.detectedIntentType,
      createdAt: Date.now(),
      trustTier: this.classifyTrustTier(parsed),
    };
  }

  private classifyTrustTier(plan: any): 1 | 2 | 3 {
    const intentType: string = plan.detectedIntentType ?? '';
    if (intentType.includes('.information.') || intentType.includes('.navigation.')) return 1;
    if (intentType.includes('.manipulation.') || intentType.includes('.creation.')) return 2;
    if (intentType.includes('.execution.') || intentType.includes('.collaboration.') || intentType.includes('.delegation.')) return 3;
    return 2;
  }

  /**
   * Strip the hot snapshot down to the minimum the LLM needs.
   * Sending the entire hot snapshot for every call would burn tokens.
   */
  private stripHotSnapshotForPrompt(snapshot: SemanticSnapshot) {
    return {
      activeRegion: snapshot.hot.activeRegion,
      activeEntityId: snapshot.hot.activeEntity.id,
      activeEntityDisplayName: snapshot.hot.activeEntity.displayName,
      activeEntityRole: snapshot.hot.activeEntity.role,
      selections: snapshot.hot.selections.map((s) => ({ id: s.id, displayName: s.displayName, role: s.role })),
      ephemeral: snapshot.hot.ephemeral,
    };
  }
}
