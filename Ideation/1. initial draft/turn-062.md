# Turn 62 — USIR

> **USIR responded:**

# The Semantic Horizon, Part 3: Proactive Computing — From Command to Symbiosis

In Part 2, we broke the Universal Semantic Interaction Runtime (USIR) out of the digital screen and mapped the physical world. By merging IoT sensors and XR spatial volumes into the `SemanticSnapshot`, we gave the user the ability to interact with lamps, thermostats, and physical documents as easily as a text file.

But a profound limitation remains. Up to this point, USIR is entirely **reactive**. 

The system sits idle, waiting for the human to speak a command, click a button, or perform a deliberate gaze-and-pinch gesture. It is a masterfully efficient servant, but it is still just a servant. 

The holy grail of Ambient Computing is not just executing commands faster; it is **Implicit Computing**. It is a system that anticipates needs based on passive signals, acting as an active symbiont in the user's cognitive workflow. 

If USIR is truly an ambient OS, it must transition from *Command* to *Symbiosis*. In this post, we will explore how to upgrade the `@usir/runtime` to continuously analyze physiological and implicit metrics, allowing the system to initiate help before you even ask for it.

---

### 1. The Implicit Modality: Beyond Voice and Clicks

In our foundational architecture, we created the `FusedIntent` payload, which combined a linguistic channel (voice/text) with a pointing channel (cursor/gaze). To enable proactive computing, we must introduce a third channel: **The Implicit Modality**.

Implicit signals are passive indicators of human cognitive state. They aren't deliberate actions; they are side-effects of thinking. 

We expand the `FusedIntent` struct in `packages/audio-pipeline/src/fused-intent.ts` (which now acts as a generalized sensor-fusion pipeline) to include these signals:

```typescript
export interface ImplicitSignals {
  // IDE / 2D signals
  cursorDwellTimeMs: number; 
  typingCadence: 'flow' | 'erratic' | 'halted';
  repeatedScrollPattern: boolean; // E.g., scrolling wildly between two files
  
  // XR / Physiological signals (if hardware permits)
  gazeFixationCount: number; // Re-reading the same block of code/text
  pupilDilationDelta: number; // Proxy for cognitive load/stress
}

export interface FusedIntent {
  linguistic?: { source: 'voice', raw: string }; // Optional now!
  pointing: { source: 'cursor' | 'gaze', activeEntityId: string };
  implicit: ImplicitSignals;
  timestamp: number;
}
```

Notice that `linguistic` is now optional. An intent can be fired into the runtime *without the user saying a word*. 

### 2. Predictive Topological Execution

If intents are firing without explicit commands, how do we prevent the system from becoming annoying, like a hyperactive Clippy? 

We solve this using **Predictive Topological Execution**. The LLM (or a faster, specialized classifier model running locally) continuously analyzes the Hot and Warm tiers of the Semantic Snapshot against the incoming stream of `ImplicitSignals`.

It looks for specific, high-friction patterns:
*   **The Stuck Loop:** The user's cursor has dwelled on a massive stack trace (Warm Tier diagnostic) for 45 seconds. Their typing cadence is `halted`, and their gaze fixation count is high. 
*   **The Context Thrashing:** The user rapidly switches between `auth.ts` and `api.ts` five times in 30 seconds (tracked via the Hot Tier history), indicating they are struggling to map the flow between the two files.

When the classifier detects a high-friction pattern, it generates an `ExecutionPlan`. But crucially, it does **not** execute it. Instead, it flags the plan as `Proactive`.

```json
{
  "intent": "Explain the stack trace in the terminal",
  "trigger": "implicit.dwell_on_error",
  "confidence": 0.88,
  "proactive": true,
  "steps": [
    { "tool": "explainEntity", "args": { "targetId": "diag://terminal#L42" } }
  ]
}
```

### 3. Reverse Collaborative Narrowing

When the `TopologicalExecutor` receives a plan flagged as `Proactive`, it halts. It cannot take destructive or distracting action without consent. Instead, it initiates **Reverse Collaborative Narrowing**.

In Part 5 of the foundational series, we introduced the Visual Handshake: when the AI was confused, it highlighted options and waited for the user to choose. Here, we reverse the flow. The *user* is confused, and the *AI* highlights a solution.

If the user is staring at the stack trace, the USIR Disambiguation UI gently steps in. 
1. **The Gentle Nudge:** It paints a soft, glowing highlight over the error in the terminal.
2. **The Ambient Offer:** A tiny tooltip (or a whisper in an XR earpiece) says: *"Want me to trace this exception?"*

This is a micro-interaction. It does not break the user's flow state. They do not have to open a chat window, copy the error, and ask, "What does this mean?" 

To accept the offer, the user simply utilizes the Universal Intent Ontology's `L0 Meta Intents`. They nod their head (if in XR), or simply say *"Yes"* or *"Please."* The runtime intercepts this `ConfirmIntent`, approves the pending proactive plan, and executes the trace. 

If the user ignores the highlight and starts typing, the system immediately drops the proactive plan and fades the highlight.

### The Thin Line Between Helpful and Annoying

The design of a proactive system requires immense restraint. The history of UI design is littered with proactive assistants that users hated because they interrupted flow rather than augmenting it.

USIR avoids the "Clippy Trap" through three strict architectural rules:
1. **Never mutate state proactively:** Proactive plans are restricted to `L3 Information Intents` (Explain, Compare, Trace). USIR will never proactively edit a file, send an email, or delete a resource.
2. **Sovereign Decay:** Proactive offers decay rapidly. If the user doesn't respond within a short window, or if their focus (`activeEntityId`) shifts, the offer vanishes instantly.
3. **Implicit Feedback Loops:** If a user repeatedly ignores proactive offers in a specific context (e.g., they ignore CSS layout suggestions), the `InteractionMemory` logs the decay. The confidence threshold for triggering proactive intents in that domain is automatically raised, adapting to the user's expertise.

### Achieving Symbiosis
By integrating implicit telemetry, predictive planning, and Reverse Collaborative Narrowing, USIR transforms from a tool into a partner. It watches the Semantic Graph alongside you. When it sees you stumble, it places the exact tool you need right at your fingertips, waiting for a nod of approval.

We have now built a system that understands the physical world, resolves ambiguity flawlessly, and anticipates our needs. But it is still entirely bound to the user's immediate, synchronous attention. 

What happens when a task is too big to be completed while you watch? What happens when you need to delegate?

---
**Next up in Part 4:** *Agentic Delegation — The L7 Intents and Asynchronous Graphs.* We will explore how USIR hands off complex, multi-hour tasks to autonomous "Worker Agents." We will look at how to securely restrict an agent's access to your personal Semantic Graph, and how these agents communicate their progress back to you for approval.