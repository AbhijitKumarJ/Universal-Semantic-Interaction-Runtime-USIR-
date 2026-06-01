# Beyond the GUI, Part 5: Collaborative Narrowing — The End of "AI Hallucination" in UX

In [Part 4](./04-the-runtime.md), we built the Runtime: a deterministic engine that remembers context, parses intent into an `ExecutionPlan`, and safely runs operations via a Topological Executor.

But we left one critical scenario unaddressed.

Imagine a developer is looking at a massive configuration file. They press their push-to-talk hotkey and say, *"Update the retry timeout to 500."*

The Intent Router looks at the `SemanticSnapshot` and realizes there are three different `retry_timeout` variables in the file (one for the database, one for the API, one for the cache).

How should the system respond?

- **The Chatbot Approach:** The execution fails, and the AI replies in a chat window, *"I found three timeouts. Did you mean the DB, the API, or the Cache?"* The user sighs, takes their hands off the keyboard, and types a reply. The flow state is broken.

- **The "Agentic" Approach:** The AI guesses. It picks the API timeout because it was mentioned recently in the repo. It guesses wrong. The user has to undo the change. Trust is broken.

This is the failure point of modern AI UX. We treat ambiguity as an error state.

In the Universal Semantic Interaction Runtime (USIR), ambiguity is not an error. It is a core feature of human communication. We handle it through a fundamentally new interaction paradigm called **Collaborative Narrowing**.

## The Architecture of Doubt

When we designed the prompt for the Intent Router, we explicitly forbade the LLM from guessing when it lacked context. Instead, we forced it to declare its uncertainty using two fields: `confidence` and `ambiguities`.

```json
{
  "intent": "Update the retry timeout",
  "confidence": 0.45,
  "ambiguities": [
    {
      "field": "steps[0].args.targetEntity",
      "candidates": ["db_retry_timeout", "api_retry_timeout", "cache_retry_timeout"],
      "question": "Which timeout did you mean?",
      "options": ["Database", "API", "Cache"]
    }
  ]
}
```

When the router returns a plan with ambiguities, the runtime *pauses* execution and surfaces a disambiguation `InteractionWaypoint` to the user.

## The Handshake: Visual + Audio + Haptic

The disambiguation waypoint uses every available modality to make the choice effortless. From `packages/runtime/src/disambiguation/collaborative-narrowing.ts`:

```typescript
export function buildDisambiguationWaypoint(args: {
  waypointId: string;
  rawInstruction: string;
  candidates: SemanticEntity[];
  contextHint?: string;
}): InteractionWaypoint {
  const phonetic = assignPhoneticNames(candidates);

  const options = candidates.map((e) => ({
    id: e.id,
    label: `${phonetic.get(e.id)} — ${e.displayName}`,
  }));

  return {
    id: args.waypointId,
    presentations: {
      display: {
        layout: 'wizard_list',
        prompt: `"${args.rawInstruction}"`,
        options,
      },
      audio: {
        tts: `I found ${candidates.length} matches. ${candidates.map((e, i) => 
          `${phonetic.get(e.id)}: ${e.displayName}`).join('; ')}. Which one?`,
        autoPlay: true,
      },
      haptic: { pattern: 'attention_double', timing: 'immediate' },
      spatial: { layout: 'floating_panel', content: '...' },
    },
    expectedInputs: {
      voice: {
        intents: options.map((o) => ({
          utterances: [o.label.split(' — ')[0]!.toLowerCase(), o.id],
          intentType: 'intent.attention.select',
        })),
      },
      touch: {
        events: options.map((o) => ({ target: o.id, action: 'select' })),
      },
      gesture: {
        actions: [{ type: 'point', target: candidates[0]?.id, action: 'select' }],
      },
    },
    fallback: {
      channels: [{ channel: 'sms', body: 'Pick one: ...' }],
      timeoutMs: 60_000,
      onExhaustion: 'queue',
    },
  };
}
```

Three things happen simultaneously:

1. **The UI highlights the candidates.** Each one gets a "hand wave" animation and a badge: "Alpha — Database timeout", "Bravo — API timeout", "Charlie — Cache timeout."

2. **The audio says it aloud.** Using the NATO phonetic alphabet (Alpha, Bravo, Charlie) avoids ambiguity in voice input. "C" and "B" and "D" are notoriously hard to distinguish over audio; "Alpha", "Bravo", "Charlie" are not.

3. **The watch vibrates.** A double-tap pattern means "this needs your decision."

The user can now respond via *any* modality: tap a button, say "Bravo", or point at the panel (if they're in XR). The runtime normalizes the input into a single `IntentEnvelope` and feeds it back into the plan.

## Relative Drill-Down: The Power of Memory

The first round of disambiguation is rarely the last. Imagine the user said "Alpha" but actually meant a different timeout, one they were just talking about. They say, *"Not Alpha. The one below it."*

The runtime:
1. Looks at the `InteractionMemory` to find the "Alpha" entity
2. Uses spatial logic to find what's "below" it
3. Returns a new, narrower candidate list (often just one)
4. If still ambiguous, displays a second round of disambiguation

The key insight: **every disambiguation becomes a memory entry**. The user's corrections are themselves intents, and the runtime learns from them in the moment. The follow-up "Not Alpha, the one below it" updates the spatial relationships in memory, so subsequent commands can use the same context.

## The Confidence Cascade

We have one more trick. Not every disambiguation needs a full visual handshake. If the LLM is *very* confident in its top candidate (e.g. 0.92) but uncertain about the rest (0.4 each), the runtime can do a lighter "confirm" waypoint:

> *"I'm pretty sure you mean the API timeout. Confirm?"*

The user can:
- **Confirm** with "yes" or a thumbs-up
- **Correct** with "no, the database one"
- **Defer** with "let me think"

Each response becomes a memory entry that informs the next plan. Over time, the runtime's priors calibrate to the user's specific codebase and vocabulary, requiring fewer disambiguation steps.

## The Fallback Chain: Capability-Zero Devices

What if the user is on a feature phone with no display, no voice, and no smart watch? The runtime still needs to reach them.

Every disambiguation waypoint includes a `FallbackChain`:

```typescript
fallback: {
  channels: [
    { channel: 'sms', body: 'Pick one: Alpha (DB) | Bravo (API) | Charlie (Cache). Reply with letter.' },
    { channel: 'email', body: '...' },
    { channel: 'voice_call', spokenSummary: '...' },
  ],
  timeoutMs: 60_000,
  onExhaustion: 'queue',
}
```

The runtime tries the primary modalities first (display + voice). If the user doesn't respond in 60 seconds, it escalates to SMS. If no response there, it queues the disambiguation for the next time the user opens any USIR-aware device.

The result: the user is never stuck. They can always make progress, even on the dumbest of devices.

## What's Next

We've built a runtime that handles single-user interaction gracefully. But humans don't work alone. In [Part 6](./06-ambient-computing.md), we will scale USIR to the entire computing experience: federating multiple runtimes, sharing semantic graphs across teams, and ultimately killing the "App" as we know it.

---

**Next:** [Part 6: Ambient Computing — Killing the "App"](./06-ambient-computing.md)
