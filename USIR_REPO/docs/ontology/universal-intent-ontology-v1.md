# Universal Intent Ontology — 1.0 Candidate

> **Status:** Candidate for community review
> **Version:** 1.0-rc.1  
> **Last updated:** 2026-06-02

## Overview

The Universal Intent Ontology (UIO) is the shared verb vocabulary of the USIR ecosystem. Every adapter, agent, and runtime uses these intent types to describe *what the user wants to do*, independent of *how* any particular app implements it.

Think of it as **HTTP methods for human-computer interaction** — just as `GET`/`POST`/`PUT`/`DELETE` decouple REST clients from servers, UIO intent types decouple intention from execution.

## Layer Architecture

Intents are organized in 8 cognitive layers, each building on the previous:

| Layer | Name | Focus | Examples |
|-------|------|-------|----------|
| L0 | Meta | The conversation/system itself | cancel, repeat, help, undo |
| L0.5 | Provenance | History/why of mutations | trace, audit, revert |
| L1 | Navigation | Finding/positioning | locate, open, close, navigate |
| L2 | Attention | Focus/selection | focus, select, highlight |
| L3 | Information | Reading/computing | explain, summarize, compare, search |
| L4 | Manipulation | Modifying entities | edit, move, delete |
| L5 | Creation | Making new entities | create |
| L6 | Execution | Triggering effects | run, schedule |
| L7 | Delegation | Handing off to agents | plan, delegate, checkpoint |
| L8 | Collaboration | Sharing with others | share, discuss, annotate, broadcast |

## Intent Type Encoding

All intents follow the pattern: `intent.<layer>.<verb>`

Examples: `intent.navigation.locate`, `intent.attention.select`, `intent.manipulation.edit`

### L0 — Meta Intents

| Type | Description | Payload |
|------|-------------|---------|
| `intent.meta.cancel` | Abort current operation | — |
| `intent.meta.repeat` | Repeat last utterance | — |
| `intent.meta.help` | Request help | — |
| `intent.meta.undo` | Undo last mutation | — |
| `intent.meta.redo` | Redo last undone mutation | — |

### L1 — Navigation Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.navigation.locate` | Find an entity in the graph | `target`: CognitiveReference, `filters?`: role/attributes/spatial |
| `intent.navigation.open` | Open an entity (file, app, panel) | `target`: CognitiveReference |
| `intent.navigation.close` | Close an entity | `target`: CognitiveReference |
| `intent.navigation.navigate` | Move focus to a destination | `target`, `destination?`: CognitiveReference + cursor position |

### L2 — Attention Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.attention.focus` | Direct focus to a region | `target`, `region?` |
| `intent.attention.select` | Select one or more entities | `target`, `selection?`: start/end range |
| `intent.attention.highlight` | Visually emphasize | `target`, `style?`, `durationMs?` |

### L3 — Information Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.information.explain` | Explain an entity | `target`, `depth?`: brief/normal/detailed |
| `intent.information.summarize` | Summarize content | `target`, `maxLength?` |
| `intent.information.compare` | Compare multiple entities | `targets`: array, `dimension?` |
| `intent.information.search` | Search for information | `query`, `scope?` |

### L4 — Manipulation Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.manipulation.edit` | Modify an entity | `target`, `operation`: rename/replace/insert/delete/transform, `value?` |
| `intent.manipulation.move` | Relocate an entity | `target`, `destination` |
| `intent.manipulation.delete` | Remove an entity | `target`, `soft?`: boolean |

### L5 — Creation Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.manipulation.create` | Create a new entity | `entityRole`, `parent`, `name`, `template?`, `content?` |

### L6 — Execution Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.execution.run` | Execute a command | `target`, `command?`, `args?` |
| `intent.execution.schedule` | Schedule future execution | `target`, `when`, `recurring?` |

### L7 — Delegation Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.delegation.plan` | Ask agent to create a plan | `target`, `objective` |
| `intent.delegation.delegate` | Delegate execution to agent | `target`, `objective`, `constraints?`, `confidenceThreshold?`, `sandboxEntityIds?` |
| `intent.delegation.checkpoint` | Approve/reject agent step | `stepIndex`, `decision`: approve/reject/discuss |

### L8 — Collaboration Intents

| Type | Description | Key Payload |
|------|-------------|-------------|
| `intent.collaboration.share` | Share entities with another runtime | `target`, `collaboratorId`, `permissions`, `expiresAt?` |
| `intent.collaboration.discuss` | Send a message about an entity | `target`, `message`, `preferredModality?` |
| `intent.collaboration.annotate` | Add annotation to an entity | `target`, `annotation`, `anchor?` |
| `intent.collaboration.broadcast` | Broadcast to recipients | `annotationId`, `recipients`, `modality?` |

## CognitiveReference

Many intents use `CognitiveReference` instead of a direct entity ID. This allows the user to refer to entities by memory ("the file I was just looking at"), spatial position ("the panel on the right"), or semantic description ("the function that parses JSON").

```typescript
interface CognitiveReference {
  // Direct ID resolution (highest priority)
  entityId?: string;
  // Recency-based reference
  recency?: { position: number; context?: string };
  // Spatial reference
  spatial?: { region: string; direction?: 'left' | 'right' | 'above' | 'below' | 'nearest' };
  // Semantic description
  description?: string;
  // Role filter
  role?: string;
}
```

## Ambiguity Resolution

When the runtime cannot resolve a reference uniquely, it emits an `Ambiguity`:

```typescript
interface Ambiguity {
  field: string;         // JSON-path to the ambiguous field
  candidates: string[];  // Candidate entity IDs
  question: string;      // Natural language question
  options?: string[];    // Suggested response options
}
```

The runtime then builds a disambiguation waypoint (see `InteractionWaypoint`) that renders the choice across all modalities (voice, touch, gesture, SMS fallback).

## Extending the Ontology

To propose a new intent type:

1. Open a PR in `docs/ontology/proposals/` with a markdown file describing:
   - The use case
   - Why existing intent types don't cover it
   - Proposed `type` string and payload interface
2. The community reviews and votes
3. Once accepted, the type is added to the next minor version

## Design Principles

1. **Verb-centric, not noun-centric** — Intents describe actions, not things. Entities describe things.
2. **Composable** — A complex task decomposes into a DAG of simple intents.
3. **Cross-modal** — The same intent works for voice, touch, gesture, keyboard, and XR.
4. **Backward compatible** — New intent types are additive; old types never change their interface.
5. **Minimal** — If a verb can be expressed as a combination of existing intents, don't add a new one.
