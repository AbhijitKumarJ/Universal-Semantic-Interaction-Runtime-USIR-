# BMAD Wizard Example

A minimal example showing how to build a multi-step guided brainstorming flow using USIR's `InteractionWaypoint` protocol.

## What it does

The BMAD (Background, Mission, Action, Decision) method is a 4-step brainstorming framework. This PoC implements the first 3 steps as a series of `InteractionWaypoints`:

1. **Background** — set the problem context
2. **Mission** — define the success criteria
3. **Action (Diverge)** — capture as many ideas as possible

Each waypoint is fully multi-modal:
- **Display** — wizard UI with selectable options
- **Audio** — TTS summary that auto-plays
- **Haptic** — notification pattern for wearables
- **Spatial** — XR floating panel (when supported)
- **Fallback** — SMS/email for capability-zero devices

## Run

```bash
# From the USIR_REPO root
pnpm install
pnpm --filter @usir/protocol build
npx ts-node examples/bmad-wizard/wizard.ts
```

## Expected output

```
=== USIR BMAD Wizard PoC ===

Step: bmad_background
  Objective: Set the context for brainstorming
  Display prompt: Let's start with the background. What problem are you trying to solve?
  TTS: Let's start with the background. What problem are you trying to solve? A technical problem, A business problem, A design problem, or Something else.
  Fallback: sms
...
```

## How it works

The `buildSimpleWaypoint` helper from `@usir/protocol/waypoint` creates a waypoint with:
- A user-facing prompt
- Multiple choice options
- Voice intents matching each option
- Touch events for tap selection
- An SMS fallback for dumb devices

In a real implementation, the waypoints would be rendered by a web view (HTML), spoken by a TTS engine, and the user's response (voice, touch, or SMS) would be routed back through the runtime as an `IntentEnvelope`.

## Extending

The wizard can be extended by:
- Adding a 4th "Decision" step that uses `CompareIntent` to score the captured ideas
- Replacing the canned options with free-form text input (using `expectedInputs.voice.grammar.type = 'open'`)
- Adding spatial anchors for XR rendering
- Persisting the session to the user's semantic graph via `intent.manipulation.create`
