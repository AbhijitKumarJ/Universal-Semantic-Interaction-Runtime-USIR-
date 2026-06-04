# The Architecture of Intent, Part 11: Collaborative Narrowing (Resolving Ambiguity)

*Engineering the Post-GUI Era — Part 11 of 14*

---

The greatest failure of modern AI user experience is how it handles ambiguity.

Imagine a developer is looking at a massive configuration file. They press their push-to-talk hotkey and say, *"Update the retry timeout to 500."*

The LLM looks at the DOM or AST and realizes there are three different `retry_timeout` variables on screen (one for the database, one for the API, one for the cache). 

Current AI paradigms offer two equally terrible ways to handle this:
1. **The Chatbot Approach:** The execution halts. A chat panel slides open, and the AI prints: *"I found three timeouts. Did you mean the DB, the API, or the Cache?"* The user sighs, moves their hands back to the keyboard, and types a reply. The flow state is broken.
2. **The "Agentic" Approach:** The AI guesses. It picks the API timeout because it was mentioned recently in the prompt context. It guesses wrong. The user has to realize the mistake and manually undo the change. Trust is broken.

We treat ambiguity as an error state to be avoided. 

In the Universal Semantic Interaction Runtime (USIR), ambiguity is not an error. It is a fundamental feature of human communication. USIR handles it through a completely different interaction paradigm called **Collaborative Narrowing**.

### The Architecture of Doubt

As we covered in [Part 7](./07-planners-not-operators.md), the USIR Intent Router is strictly forbidden from guessing. If its confidence drops below a threshold (e.g., `0.75`), it populates an `ambiguities` array in the JSON `ExecutionPlan`, inserting a sentinel value (`«UNRESOLVED:fieldName»`) into the tool arguments.

When the `TopologicalExecutor` sees this sentinel, it halts the DAG. It hands the ambiguity over to the USIR disambiguation engine.

The engine's job is to bridge the gap between human vagueness and machine exactness without breaking the user's flow. It does this via the **Visual Handshake**.

Let's look at `packages/runtime/src/disambiguation/collaborative-narrowing.ts`:

```typescript
const PHONETIC_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', // ...
];

export function buildDisambiguationWaypoint(args: {
  waypointId: string;
  rawInstruction: string;
  candidates: SemanticEntity[];
}): InteractionWaypoint {
  const phonetic = assignPhoneticNames(args.candidates);

  const options = args.candidates.map((e) => ({
    id: e.id,
    label: `${phonetic.get(e.id)} — ${e.displayName}`,
  }));

  // ... constructs the Waypoint
}
```

Instead of asking a text question in a chat box, the runtime dynamically assigns a NATO phonetic name ("Alpha", "Bravo", "Charlie") to each candidate `SemanticEntity`. 

Why the NATO phonetic alphabet? Because Speech-to-Text (STT) models notoriously confuse short letters ("B", "C", "D", "E"). "Alpha", "Bravo", and "Charlie" are mathematically distinct in phoneme space. They guarantee near 100% transcription accuracy even in noisy environments.

### The `InteractionWaypoint` Primitive

USIR doesn't know what device the user is currently looking at. To render the Visual Handshake, it emits an `InteractionWaypoint`. 

The Waypoint was the very first architectural concept defined in the USIR ideation phase, and it remains the bedrock of its modality-agnostic design. Let's look at its schema in `packages/protocol/src/waypoint/index.ts`:

```typescript
export interface InteractionWaypoint {
  id: string;
  context: { state: string; objective: string };
  
  /** How this waypoint is presented across modalities */
  presentations: {
    display?: DisplayPresentation;   // E.g., Wizard UI highlighting code
    audio?: AudioPresentation;       // E.g., TTS reading the options
    spatial?: SpatialPresentation;   // E.g., XR floating panels over physical objects
    haptic?: HapticPresentation;     // E.g., Watch double-tap
  };
  
  /** How the user can respond */
  expectedInputs: {
    voice?: VoiceInput;
    touch?: TouchInput;
    gesture?: GestureInput;
  };
  
  /** Fallback chain for capability-zero devices */
  fallback: FallbackChain;
}
```

When the `buildDisambiguationWaypoint` function executes, it populates *all* of these fields simultaneously. 

If the user is at their desk, the VS Code adapter catches the `display` presentation. It paints temporary, audio-friendly overlays directly on the code editor over the three candidates, labeling them `[Alpha]`, `[Bravo]`, and `[Charlie]`. 

If the user is driving, the car integration catches the `audio` presentation. The TTS says: *"I found three timeouts. Alpha is the database, Bravo is the API, Charlie is the cache. Which one?"*

If the user is wearing a smartwatch, the `haptic` presentation fires a double-tap vibration on their wrist, signaling that the system is paused and waiting for a decision.

The user simply speaks, *"Bravo"*, or taps the `[Bravo]` highlight on their screen. The LLM is bypassed completely; the expected input maps "Bravo" directly to the underlying `SemanticEntity` ID. The `«UNRESOLVED»` sentinel is replaced, and the `TopologicalExecutor` resumes in milliseconds. 

This is Collaborative Narrowing: The AI narrows the universe to N candidates, and the human trivially narrows it to 1.

### The Fallback Chain: Capability-Zero Devices

True ambient computing means the system cannot rely on the user having a $3,500 XR headset or an open IDE at all times. 

Notice the `fallback` node in the `InteractionWaypoint` schema. What happens if the `TopologicalExecutor` hits a blocker while running a delegated background task, but the user's laptop is closed and they aren't wearing a smartwatch?

```typescript
export interface FallbackChain {
  channels: Array<{
    channel: 'sms' | 'email' | 'push' | 'voice_call';
    body?: string;
  }>;
  timeoutMs: number;
  onExhaustion: 'defer' | 'queue' | 'discard';
}
```

If the primary modalities fail to register a response within `timeoutMs`, the runtime automatically degrades. It sends an SMS: *"USIR: Which timeout? Reply A (Database), B (API), C (Cache)."*

The user texts back "B". The webhook catches it, translates it to an `IntentEnvelope`, and the execution resumes. The interaction contract remains unbroken across the hardware divide.

### The Critical Take: The "Bravo" Problem

Collaborative Narrowing is a brilliant systems-engineering solution to the hallucination problem, but it introduces a subtle UX friction.

By relying on NATO phonetic alphabets to ensure deterministic STT resolution, USIR occasionally forces the user to speak like a military radio operator. If you say, *"Update the timeout,"* and the system highlights three variables and prompts you to say "Alpha, Bravo, or Charlie," the interaction feels slightly robotic.

Humans want to say, *"The database one,"* or *"The second one."* 

USIR *does* support this via the `InteractionMemory` resolvers we covered in [Part 6](./06-grounding-the-llm.md), which can map "the database one" back to the correct candidate. However, resolving natural language requires routing the audio back through the LLM for semantic extraction, which reinjects latency into the disambiguation loop.

The strict "Bravo" mapping bypasses the LLM entirely, mapping the spoken word directly to a strict `action` string in the `expectedInputs` block. This guarantees 0-latency resolution but sacrifices conversational fluidity. 

UX design is a pendulum between deterministic accuracy and human naturalness. By leaning heavily into the Visual Handshake and phonetic mapping, USIR chooses determinism. In high-stakes engineering and operational tasks, this is almost certainly the right trade-off—but it will take user retraining to get comfortable with it.

### What's Next

We have now covered how the runtime parses intent, plans execution, synchronizes across peers, and resolves ambiguity. The core computational loop of USIR is complete.

But if applications are just stateless capability providers, how does USIR find them? How are developers compensated if they don't own the UI or the user data?

In **Part 12**, we will tear down the App Store monopoly. We will explore `@usir/registry`—the **Capability Marketplace**—and dissect how USIR handles dynamic capability discovery, trust decay, and programmatic invoicing.

---
*Next:* **[Part 12: The Capability Marketplace (Death of the App Store)]**