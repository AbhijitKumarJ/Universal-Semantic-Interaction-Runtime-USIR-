# The Semantic Horizon, Part 2: The Ambient Sensorium — Merging the Physical and Digital Graphs

In [Part 1](./01-zero-shot-adapter.md), we broke the Universal Semantic Interaction Runtime (USIR) out of the IDE and unleashed it onto the vast, messy world of legacy 2D software using the Zero-Shot Adapter. But as long as our semantic graph is confined to a screen, we are still thinking too small.

The physical world is undergoing a massive, fragmented digitization. We have IoT smart bulbs, Bluetooth-enabled thermostats, spatial computing (XR) headsets mapping our living rooms, and ultra-wideband (UWB) beacons tracking our wearables.

Today, this ecosystem is a nightmare of silos. To change a lightbulb's color while reviewing a pull request in an XR headset, you have to mentally task-switch, summon a virtual smartphone, open a specific "Smart Home" app, and press a virtual button.

This violates the core tenet of Ambient Computing. **A smart lamp is not an app. It is a Semantic Entity.**

If USIR is truly universal, the runtime shouldn't care whether an entity is a TypeScript file on your hard drive or a physical thermostat on your wall. In this post, we will expand USIR's adapter layer into the **Ambient Sensorium**, seamlessly merging the physical and digital domains into a single, unified Semantic Graph.

## 1. Expanding the Protocol: Physical Entities

To bring the physical world into USIR, we don't need a new protocol. We simply need to expand our ontology.

In `@usir/protocol`, we extend the `EntityRole` type to accommodate the physical domain, and we upgrade our `SpatialBounds` from 2D coordinates (`x, y, width, height`) to 3D volumetric meshes.

```typescript
// Expanded roles in packages/protocol/src/entities/index.ts
export type EntityRole = 
  | 'source_file' 
  | 'ui_region'
  // --- New Physical Roles ---
  | 'physical_device' 
  | 'spatial_anchor'
  | 'environmental_sensor';

export interface SpatialVolume {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation?: { x: number; y: number; z: number; w: number };
}

export type SpatialBounds = SpatialBounds2D | SpatialVolume;
```

A `physical_device` like a smart lamp now occupies a `SpatialVolume` in the room. A `spatial_anchor` (like a desk corner or a wall) provides the origin point for the coordinate system.

## 2. The Continuous Hot Tier

In a 2D IDE, the "Hot Tier" is event-driven: a user clicks, the cursor moves, we update the snapshot. In an Ambient Sensorium, the environment is continuously streaming telemetry.

If we only updated the snapshot on user actions, the runtime wouldn't know if a motion sensor triggered or if a smart fridge door opened.

We introduce the concept of a **Continuous Hot Tier**. Certain entities (motion sensors, presence detectors, biometric wearables) push their state asynchronously into the runtime's memory at a high frequency (e.g., 10Hz).

```typescript
// In packages/runtime/src/memory/continuous-hot.ts
export class ContinuousHotBuffer {
  private environmentalState: Map<string, SemanticEntity> = new Map();

  public ingestSensorData(entityId: string, payload: Record<string, unknown>) {
    // Merge payload into the entity, update timestamp
    const entity = this.environmentalState.get(entityId);
    if (entity) {
      entity.attributes = { ...entity.attributes, ...payload };
      entity.updatedAt = Date.now();
    }
  }
}
```

This buffer is what allows the LLM to answer questions like, *"Why did the lights just turn on?"* by correlating the state change in the `physical_device` with an `environmental_sensor` (motion detected in room 2).

## 3. Gaze Vectors and Spatial References

In Part 2 of the original series, we defined `SpatialReference` for 2D screens. In the Ambient Sensorium, spatial references become 3D.

When a user wearing XR glasses says, *"Move that window over there,"* the runtime needs to resolve the vague spatial reference. We do this by feeding the user's **gaze vector** into the resolver.

```typescript
// In packages/protocol/src/memory/index.ts
export interface SpatialReference extends BaseReference {
  kind: 'spatial';
  anchorEntityId?: string;
  direction?: 'below' | 'above' | 'left' | 'right' | 'next_to' | 'inside' | 'overlapping';
  
  // New 3D-aware fields
  gazeVector?: { origin: Point3D; direction: Point3D };
  roomMeshId?: string;
}
```

The adapter for the XR headset pushes a `gazeVector` into the user's FusedIntent. The `InteractionMemory` resolver uses this vector to perform a raycast against the `SpatialVolume` meshes of all known entities. The first entity the vector hits becomes the resolved target.

## 4. The Reality Mesh: A Sub-Graph for the World

A modern XR headset (like the Vision Pro or Quest 3) builds a continuous 3D mesh of the user's environment. This mesh is the ultimate "spatial index."

We expand the Cold Tier to include this reality mesh. The `ColdTier` in our adapter package now maintains a `SpatialGraph` alongside the `SemanticGraph`.

```typescript
// In adapters/vscode/src/snapshot/cold.ts (renamed conceptually to adapter-core)
export class AmbientColdTier extends ColdTier {
  private realityMesh: Map<string, SpatialVolume> = new Map();

  public addSpatialAnchor(id: string, volume: SpatialVolume) {
    this.realityMesh.set(id, volume);
  }
}
```

When the LLM asks, *"What is on my desk?"* the Cold Tier can query the reality mesh for all entities with `role: 'physical_device'` that intersect the desk's volume. The answer is returned as a sub-graph of physical entities, not a list of pixels.

## 5. The Unified Interaction Loop

With this expansion, the user can seamlessly transition between digital and physical tasks:

1. **User (voice + gaze):** *"Connect my code to that lamp."*
2. **Router:** Resolves `that lamp` via gaze vector hitting a `physical_device` mesh.
3. **Plan:** Creates an `intent.manipulation.edit` step to write a new MQTT topic to `main.py`, and an `intent.execution.run` step to deploy it.
4. **Executor:** The Topological Executor runs the file edit, then the deploy. The lamp turns on.
5. **Feedback:** The lamp's new state flows back into the Continuous Hot Tier. The user sees the lamp glow in their physical reality.

## Conclusion: The End of Silos

The Ambient Sensorium is what happens when you take the semantic graph seriously. It is no longer a representation of your *code*; it is a representation of your *life*. The runtime becomes the unified operating system for both the digital tools you use and the physical environment you inhabit.

By expanding the `EntityRole` and the Cold Tier to include 3D volumes and reality meshes, we allow the LLM to operate on the world itself. The distinction between "opening an app" and "turning on a light" dissolves. Both are just intents routed to capabilities.

---

**Next:** [Part 3: Proactive Computing — From Command to Symbiosis](./03-proactive-computing.md)
