# The Semantic Horizon, Part 3: Proactive Computing — From Command to Symbiosis

In [Part 2](./02-ambient-sensorium.md), we broke the Universal Semantic Interaction Runtime (USIR) out of the digital screen and mapped the physical world. By merging IoT sensors and XR spatial volumes into the `SemanticSnapshot`, we gave the user the ability to interact with lamps, thermostats, and physical documents as easily as a text file.

But a profound limitation remains. Up to this point, USIR is entirely **reactive**.

The system sits idle, waiting for the human to speak a command, click a button, or perform a deliberate gaze-and-pinch gesture. It is a masterfully efficient servant, but it is still just a servant.

The holy grail of Ambient Computing is not just executing commands faster; it is **Implicit Computing**. It is a system that anticipates needs based on passive signals, acting as an active symbiont in the user's cognitive workflow.

If USIR is truly an ambient OS, it must transition from *Command* to *Symbiosis*. In this post, we will explore how to upgrade the `@usir/runtime` to continuously analyze physiological and implicit metrics, allowing the system to initiate help before you even ask for it.

## 1. The Implicit Modality: Beyond Voice and Clicks

In our foundational architecture, we created the `FusedIntent` payload, which combined a linguistic channel (voice/text) with a pointing channel (cursor/gaze). To enable proactive computing, we must introduce a third channel: **The Implicit Modality**.

Implicit signals are passive indicators of human cognitive state. They aren't deliberate actions; they are side-effects of thinking.

We expand the `FusedIntent` struct in `packages/audio-pipeline/src/fused-intent.ts` to include these signals:

```typescript
export interface ImplicitSignals {
  // IDE / 2D signals
  cursorDwellTimeMs: number; 
  typingCadence: 'flow' | 'erratic' | 'halted' | 'idle';
  editsPerMinute: number;
  
  // Physiological / Wearable signals
  gazeStabilityScore: number; // 0.0 to 1.0 — how stable is the gaze?
  blinkRateHz: number;        // Correlates with cognitive load
  heartRateBpm: number;       // Sudden spikes may indicate stress
  
  // Contextual state
  timeSinceLastInteractionMs: number;
  affectiveMarker?: 'confused' | 'frustrated' | 'focused' | 'curious';
}
```

The audio pipeline and the input adapters (XR headset, smart watch, OS) continuously feed this data into the runtime.

## 2. The Predictive Execution Engine

Reactive execution is synchronous: User speaks → LLM plans → Executor runs. Proactive execution is asynchronous: Signals arrive → Predictor scores situation → Executor acts (or prompts).

We introduce a new component: the **`PredictiveExecutionEngine`**. It runs as a low-priority background process within the runtime, consuming the continuous stream of `ImplicitSignals`.

```typescript
// In packages/runtime/src/predictive/engine.ts
export class PredictiveExecutionEngine {
  constructor(private llm: LLMRouter) {}

  public async onImplicitUpdate(signals: ImplicitSignals, snapshot: SemanticSnapshot) {
    // Look for "stuck" patterns
    if (signals.typingCadence === 'erratic' && signals.timeSinceLastInteractionMs > 30000) {
      const prompt = `User is stuck. Current entity: ${snapshot.hot.activeEntity.id}. 
                      Generate a proactive assistance plan.`;
      
      // We use the existing LLM Router, but with a specific "proactive" persona
      const plan = await this.llm.route({
        rawInstruction: prompt,
        snapshot,
        memory: { /* ... */ },
      });

      // Proactive plans have a lower trust tier requirement
      // They often use L3 Information intents (ExplainIntent) rather than L4 (Edit)
      this.suggestPlan(plan);
    }
  }
}
```

## 3. The Symbiosis Loop: From Suggestion to Frictionless Action

A proactive suggestion that interrupts the user defeats the purpose. It must be frictionless.

When the Predictive Engine generates a plan, it doesn't *execute* it. It prepares a `ProactiveWaypoint`.

The waypoint sits quietly in a peripheral UI channel: a subtle glow on the side of the smart watch, a whisper in the earbud when the user pauses typing, or a floating spatial card that appears only when the user explicitly looks for it.

The user can:
- **Accept** it with a simple gesture (e.g., a double nod, a spoken "go ahead")
- **Defer** it ("remind me later")
- **Reject** it ("no, leave me alone")

Because USIR treats memory as infrastructure, the runtime *learns* from these interactions. If the user rejects proactive help during deep focus, the engine backs off. If they accept it during moments of hesitation, the engine leans in.

## 4. The Ethical Substrate: Trust and Affective Markers

Proactive computing is a tightrope walk over the canyon of annoyance. We introduce a hard-coded ethical constraint into the runtime: **The Affective Substrate**.

The runtime maintains a baseline of the user's "affective markers" (using local, privacy-preserving sentiment analysis of voice tone and typing patterns).

```typescript
// In packages/runtime/src/predictive/ethics.ts
export class AffectiveSubstrate {
  public canInterrupt(currentState: AffectiveState): boolean {
    if (currentState === 'deep_flow') return false; // Never break flow
    if (currentState === 'frustrated') return true;  // Interrupt to help
    if (currentState === 'idle') return true;        // Okay to suggest
    return false;
  }
}
```

The `PredictiveExecutionEngine` *must* check the `AffectiveSubstrate` before surfacing a `ProactiveWaypoint`. The A2U protocol is extended to cover proactive suggestions: every proactive intent is logged to provenance with `actor: 'system'` and `rationale: 'inferred'`, giving the user full transparency and the ability to roll back any proactive state changes.

## 5. Ambient Symbiosis: The OS That Cares

When the Symbiosis loop is fully integrated, the nature of the OS changes. You stop "using" it. You collaborate with it.

The runtime notices:
- Your erratic typing and the failing test on screen → it preemptively fetches the test logs and prepares an explanation.
- Your sudden change in walking pace and the smart door unlocking → it warms up the house and starts your focus playlist.
- Your gaze lingering on a specific variable in a complex function → it generates an L3 `ExplainIntent` plan in the background, ready to deploy the millisecond you ask.

## Conclusion: The End of the Command Line

The reactive model—waiting for explicit instructions—is an artifact of the 1960s command line. Ambient Computing is the end of the command line. The OS observes, infers, predicts, and acts as a symbiont, not a terminal.

By upgrading the `FusedIntent` with physiological and cognitive signals, and adding the `PredictiveExecutionEngine` gated by the `AffectiveSubstrate`, USIR moves from being a tool you use to an environment you inhabit.

---

**Next:** [Part 4: Agentic Delegation — The L7 Intents and Asynchronous Graphs](./04-agentic-delegation.md)
