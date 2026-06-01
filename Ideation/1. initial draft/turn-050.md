# Turn 50 — USIR

> **USIR responded:**

# Beyond the GUI, Part 5: Collaborative Narrowing — The End of "AI Hallucination" in UX

In Part 4, we built the Runtime: a deterministic engine that remembers context, parses intent into an `ExecutionPlan`, and safely runs operations via a Topological Executor. 

But we left one critical scenario unaddressed. 

Imagine a developer is looking at a massive configuration file. They press their push-to-talk hotkey and say, *"Update the retry timeout to 500."*

The Intent Router looks at the `SemanticSnapshot` and realizes there are three different `retry_timeout` variables in the file (one for the database, one for the API, one for the cache). 

How should the system respond?
*   **The Chatbot Approach:** The execution fails, and the AI replies in a chat window, *"I found three timeouts. Did you mean the DB, the API, or the Cache?"* The user sighs, takes their hands off the keyboard, and types a reply. The flow state is broken.
*   **The "Agentic" Approach:** The AI guesses. It picks the API timeout because it was mentioned recently in the repo. It guesses wrong. The user has to undo the change. Trust is broken.

This is the failure point of modern AI UX. We treat ambiguity as an error state. 

In the Universal Semantic Interaction Runtime (USIR), ambiguity is not an error. It is a core feature of human communication. We handle it through a fundamentally new interaction paradigm called **Collaborative Narrowing**.

---

### The Architecture of Doubt
When we designed the prompt for the Intent Router, we explicitly forbade the LLM from guessing when it lacked context. Instead, we forced it to declare its uncertainty using two fields: `confidence` and `ambiguities`.

```json
{
  "intent": "Update the retry timeout",
  "confidence": 0.45,
  "ambiguities": [
    {
      "field": "steps[0].args.targetEntity",
      "candidates": ["db_retry_timeout", "api_retry_timeout", "cache_retry_timeout"],
      "question": "Which retry timeout did you mean?"
    }
  ],
  "steps": [
    {
      "tool": "editEntity",
      "args": { 
        "targetEntity": "«UNRESOLVED:targetEntity»", 
        "value": 500 
      },
      "dependsOn": []
    }
  ]
}
```

Notice the sentinel value `«UNRESOLVED:targetEntity»` in the arguments. 

When the `TopologicalExecutor` receives this plan, it halts. It sees the confidence is below our threshold (0.75) and that the ambiguities array is populated. Before executing any code, it hands the plan over to the **Disambiguation Loop**.

### The Visual Handshake
The Disambiguation Loop's job is to bridge the gap between human vagueness and machine exactness without breaking the user's flow. It does this by surfacing the ambiguity directly in the medium the user is currently focused on.

Because USIR separates *intent* from *presentation*, the way this ambiguity is resolved depends on the user's active client:

1.  **Voice-Only Client (Driving, Earbuds):** The system dynamically assigns phonetic names and uses TTS: *"I found three. Alpha is the database, Bravo is the API, Charlie is the cache. Which one?"*
2.  **Screen Client (VS Code MVP):** The extension paints temporary, audio-friendly overlays directly on the code editor over the three candidates, labeling them `[Alpha]`, `[Bravo]`, and `[Charlie]`. 

This is the **Visual Handshake**. The system never silently picks. It highlights the candidates and waits for a micro-interaction.

### Resolving the Sentinel
The user sees the highlights and simply says (or clicks), *"Bravo."*

Inside the runtime, `DisambiguationLoop.ts` catches this selection. It replaces the `«UNRESOLVED»` sentinel in the JSON plan with the strict ID for the API timeout, bumps the plan's confidence to `1.0`, and passes it back to the executor.

The timeout updates instantly. 

We have achieved **Collaborative Narrowing**. The human and the system jointly resolved the ambiguity through a modality-appropriate back-and-forth, taking less than two seconds, without requiring the user to type a single character of clarification.

### Modality Fusion: Preventing Ambiguity
While Collaborative Narrowing gracefully handles confusion, the best UX prevents confusion entirely. USIR achieves this through **Modality Fusion**.

In traditional UX, modalities are siloed. You either use the mouse, *or* you type a command, *or* you speak to Siri. 

In USIR, interactions are designed to be fused. The `FusedIntent` payload combines the linguistic channel (voice) with the pointing channel (cursor/selection).

```typescript
export interface FusedIntent {
  linguistic: { source: 'voice', raw: 'update the timeout' };
  pointing: { source: 'selection', activeEntityId: 'file://config.ts#L42' };
}
```

If the user says, *"Update the timeout,"* while their cursor is resting on the database configuration block, the Intent Router receives both the voice command and the Hot Tier snapshot containing the cursor location. 

The router fuses them: The voice provides the *Operation* (Update), and the cursor provides the *Target* (Database timeout). The `confidence` score hits `0.98`, the ambiguities array is empty, and the command executes instantly.

By fusing ambient gaze, cursor position, and voice, we allow humans to use natural, vague language ("fix this", "move that") while giving the machine mathematical precision.

### The End of Hallucination
By combining the deterministic `TopologicalExecutor` (Part 4) with the `DisambiguationLoop`, we completely eliminate "AI hallucination" from the UX.

If the AI hallucinates a non-existent file, the executor throws a clean error before execution. If the AI is unsure which file to pick, it triggers Collaborative Narrowing. The LLM is relegated to the one thing it is exceptionally good at—semantic routing—while rigid code handles state and safety.

We now have a complete, functional architecture. The Protocol, the Adapter, and the Runtime are working in harmony inside our VS Code MVP. 

But VS Code was only ever a testing ground. 

---
**Next up in the Finale, Part 6:** *Ambient Computing — Killing the "App".* We will zoom out and look at the ultimate vision of USIR. What happens when we take this exact architecture and apply it to web browsers, smartwatches, and spatial computing? What happens when your semantic runtime moves to a Personal Cloud OS?