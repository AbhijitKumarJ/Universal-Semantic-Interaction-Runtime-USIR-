/**
 * Execution plan types — what the LLM Router returns.
 *
 * The LLM does NOT execute intents directly. It returns an ExecutionPlan
 * (a DAG of steps), and the Topological Executor runs it deterministically.
 * This separation enables auditing, parallelism, rollback, and trust.
 */

import type { BaseIntent, Ambiguity } from '@usir/protocol/intents';

export interface ExecutionStep {
  /** Unique step id within the plan */
  stepId: string;
  /** The tool/capability to invoke (e.g. "vscode.openEntity") */
  tool: string;
  /** Args for the tool (may contain UNRESOLVED:xxx sentinels) */
  args: Record<string, unknown>;
  /** Other step ids this step waits for (for parallelism) */
  dependsOn: string[];
  /** If true, failure doesn't abort the plan */
  optional: boolean;
  /** Confidence in this step, 0-1 */
  confidence: number;
}

export interface ExecutionPlan {
  planId: string;
  /** Original raw user instruction */
  rawInstruction: string;
  /** The DAG of steps in topological order */
  steps: ExecutionStep[];
  /** Ambiguities the LLM could not resolve — surfaced for human review */
  ambiguities: Ambiguity[];
  /** Overall plan confidence */
  confidence: number;
  /** Detected intent type (for routing) */
  detectedIntentType: string;
  /** When the plan was created */
  createdAt: number;
  /** Trust tier classification (1-3) */
  trustTier: 1 | 2 | 3;
}

/**
 * Result of executing one step.
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  /** Updated entity ids affected by this step */
  affectedEntityIds: string[];
  /** Provenance node id for this step */
  provenanceId: string;
}

export interface ExecutionResult {
  planId: string;
  success: boolean;
  stepResults: StepResult[];
  totalDurationMs: number;
  /** Failed steps if any */
  failedStepIds: string[];
}
