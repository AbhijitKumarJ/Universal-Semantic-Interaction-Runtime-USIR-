# Part 13: The Semantic Horizon — IoT, XR, OS, and the Zero-Shot Adapter

*Part 13 of 14 in the USIR Deep-Dive Blog Series — "Decoding the Post-GUI Runtime"*

← [Part 12: The Capability Marketplace — An App Store Built on Intents](#) | [Part 14: Critical Analysis — What USIR Gets Right, What It Gets Wrong, and What It's Missing](#) →

---

Everything in this series up to Part 11 was about USIR operating inside software: VS Code, browsers, federated runtimes exchanging semantic graphs. Part 12 showed what a market for those capabilities might look like. This post asks the question that makes or breaks the entire vision: does USIR actually escape the screen?

The answer lives in three adapter packages — `@usir/adapters-os`, `@usir/adapters-iot`, `@usir/adapters-xr` — and in a five-part internal blog series called "The Semantic Horizon" that imagines what comes next. Reading the two together is illuminating. The code is further along than you'd expect for a pre-alpha research project; the vision is further ahead than the code in ways that are honest rather than dishonest. The gap is real, labeled, and worth understanding precisely.

There is also one idea in the Semantic Horizon docs — the Zero-Shot Adapter — that has no code at all, and is the most important idea in the entire repo.

Let's work through all of it.

---

## The Architecture Pattern Across All Three Adapters

Before going into each domain, the structural pattern is worth naming because it's consistent across all three: OS, IoT, and XR each follow the same factory + sub-adapter + security model design.

```
Adapter Architecture (consistent across OS / IoT / XR)

  createXxxAdapterRegistration(config?)
         │
         ▼
  ┌──────────────────────────────────────┐
  │  XxxAdapterRegistration              │
  │  ─────────────────────────────────── │
  │  adapterId: string                   │
  │  name: string                        │
  │  version: string                     │
  │  supportedRoles: string[]            │
  │  tools: Tool[]    ◄── flat merged   │
  │  [sub1]: adapter instance            │
  │  [sub2]: adapter instance            │
  │  ...                                 │
  └──────────────────────────────────────┘
         │
         ▼
  Tool[] consumed by TopologicalExecutor
  (same interface as VS Code tools,
   same interface as federation tools)
```

Every adapter exposes a `getTools()` method returning `Tool[]` where each tool follows the same contract: `{ name: string, description: string, execute: (args) => Promise<unknown> }`. This is the critical architectural continuity. The `TopologicalExecutor` from Part 7 doesn't know or care whether a tool is `vscode.editEntity` or `iot.mqtt.publish` or `xr.anchor.create`. They are all the same interface. If USIR ever fulfills its promise of routing a single intent across code editing, IoT actuation, and XR spatial anchoring in a single execution plan, that uniformity is why it's technically possible.

---

## The OS Adapter: The Most Dangerous One in the Repo

`@usir/adapters-os` wraps five sub-adapters — `ProcessAdapter`, `FileSystemAdapter`, `WindowAdapter`, `SystemAdapter`, and `ShellAdapter` — behind a `SecuritySandbox`. There's a reason the blog series plan singles this out as "the most dangerous adapter in the repo." Every other adapter in USIR can at worst corrupt a workspace or send a bad WebRTC signal. The OS adapter can delete files, kill processes, and execute arbitrary shell commands.

### The SecuritySandbox

The sandbox is the OS adapter's first line of defense:

```typescript
export class SecuritySandbox {
  private permissions = new Map<string, PermissionStatus>();
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      allowedReadPaths:  config?.allowedReadPaths  ?? [],
      allowedWritePaths: config?.allowedWritePaths ?? [],
      allowedCommands:   config?.allowedCommands   ?? [],
      deniedCommands:    config?.deniedCommands     ??
        ['rm -rf /', 'shutdown', 'reboot', 'init 0', 'dd'],
      defaultPermission: config?.defaultPermission  ?? 'prompt',
    };
  }

  check(request: PermissionRequest): PermissionStatus {
    const cacheKey = this.cacheKey(request);
    const cached   = this.permissions.get(cacheKey);
    if (cached) return cached;

    const result = this.evaluate(request);
    if (result !== 'prompt') {
      this.permissions.set(cacheKey, result);
      return result;
    }

    const fallback = this.config.defaultPermission;
    this.permissions.set(cacheKey, fallback);
    return fallback;
  }
}
```

There are three permission states: `granted`, `denied`, and `prompt`. The cache key is `action:path:command` — permission decisions are memoized per (action, path) pair for the lifetime of the sandbox instance, which means a first `sandbox.check({ action: 'read_file', path: '/home/user' })` that resolves to `granted` doesn't prompt again on subsequent reads of the same path.

The file access check is a simple string prefix test:

```typescript
private evaluateFileAccess(request: PermissionRequest): PermissionStatus {
  const allowed = request.action === 'read_file'
    ? this.config.allowedReadPaths
    : this.config.allowedWritePaths;
  const matches = allowed.some((prefix) => request.path!.startsWith(prefix));
  return matches ? 'granted' : (this.config.defaultPermission !== 'prompt'
    ? this.config.defaultPermission : 'prompt');
}
```

The command check is more interesting. There's a hard-coded `deniedCommands` list that catches `rm -rf /`, `shutdown`, `reboot`, `init 0`, and `dd`. But the check is prefix-based on the full command string — `rm -rf /` is caught, but `rm -rf /home/user` is not, because the check is `request.command.startsWith(d)`:

```typescript
private evaluateCommand(request: PermissionRequest): PermissionStatus {
  const cmd = request.command.trim().split(/\s+/)[0] ?? '';
  if (this.config.deniedCommands.some((d) => request.command!.startsWith(d))) return 'denied';
  if (this.config.allowedCommands.length === 0) return 'prompt';
  const allowed = this.config.allowedCommands.some((a) => cmd === a || request.command!.startsWith(a));
  return allowed ? 'granted' : 'prompt';
}
```

This is correct for the deniedCommands it covers, but the allowed/denied command approach is inherently whack-a-mole. A production deployment of the OS adapter would need a much more principled approach: mandatory allowlist mode, capability-based permissions, or integration with OS-level sandboxing (seccomp on Linux, App Sandbox on macOS). The current model correctly uses `'prompt'` as the default, which means in production nothing is auto-granted — everything without an explicit allowlist entry goes to the A2U trust gate. That's the right default. The dangerous case is any deployment that sets `defaultPermission: 'granted'`, which is what the test harness uses for convenience and what a careless integrator might copy.

### ProcessAdapter: Real execSync, Not a Simulation

Unlike the IoT and XR adapters (which are entirely in-memory simulations), the OS process adapter uses real Node.js APIs:

```typescript
private async listProcesses(): Promise<ProcessInfo[]> {
  const status = this.sandbox.check({ action: 'manage_process', reason: 'List running processes' });
  if (status === 'denied') throw new Error('Permission denied: cannot list processes');

  const output = execSync(
    'ps aux --no-headers 2>/dev/null || ps aux 2>/dev/null',
    { timeout: 5000 }
  ).toString().trim();

  return output.split('\n').slice(0, 100).map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      pid:     parseInt(parts[1], 10),
      command: parts.slice(10).join(' '),
      cpu:     parseFloat(parts[2]),
      memory:  parseFloat(parts[3]),
      state:   parts[7],
    };
  });
}
```

And `spawnProcess` calls `child_process.spawn` with `stdio: 'ignore'` and `detached: true`, immediately calling `child.unref()` — the spawned process outlives the runtime. The `signalProcess` and `killProcess` tools call `process.kill(pid, signal)` on the real OS. This is live code that works.

The `ShellAdapter` similarly uses real `exec` with configurable `timeout` and a 1MB `maxBuffer`:

```typescript
private async execCommand(args): Promise<ShellResult> {
  const command = String(args.command ?? '');
  const timeout = Number(args.timeout ?? 30000);

  const status = this.sandbox.check({ action: 'execute_command', command, reason: 'Execute shell command' });
  if (status === 'denied') throw new Error(`Permission denied: cannot execute command`);

  try {
    const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 1024 * 1024 });
    return { command, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: any) {
    return {
      command,
      stdout:   err.stdout?.toString().trim() ?? '',
      stderr:   err.stderr?.toString().trim() ?? err.message,
      exitCode: err.code ?? 1,
    };
  }
}
```

The `os.shell.pipe` tool creates persistent shell sessions — `spawn('sh', [], { stdio: ['pipe','pipe','pipe'] })` — and maps them by a session ID. This is how you'd implement a persistent terminal session that the agent can write to repeatedly without re-spawning `/bin/sh` every call. The output collection is synchronous (`let output = ''; shell.stdout?.on('data', ...)`) and there's no buffering or drain mechanism, which means reading the output of a long-running piped command requires an explicit sleep loop on the caller's side. A real implementation would use promisified `readline` or a frame protocol.

The `WindowAdapter` is the one genuinely OS-specific sub-adapter that is not implemented with real APIs. It uses simulated window data (fabricated window titles and PIDs) because there is no portable Node.js API for listing and manipulating OS windows across Linux, macOS, and Windows. A real implementation would need `xdotool` on Linux, `Quartz` CGWindowList APIs on macOS (via native binding), or Win32 `EnumWindows` on Windows. The tests pass because they're testing the in-memory simulation.

### What the OS Adapter Tools Actually Look Like

The full tool surface from `createOsAdapterRegistration`:

```
Process:     os.process.list, os.process.spawn, os.process.signal,
             os.process.kill, os.process.monitor
Filesystem:  os.fs.read, os.fs.write, os.fs.list, os.fs.stat, os.fs.search
Window:      os.window.list, os.window.focus, os.window.move
System:      os.system.info
Shell:       os.shell.exec, os.shell.pipe
```

With the `SecuritySandbox` as a gate, these form a legitimate OS automation capability set. The integration with USIR's provenance and A2U trust layers means that a `SIGKILL` sent to a PID will have a full causal chain from the originating intent, an authorization state on the `ProvenanceNode`, and an A2U checkpoint if the kill was classified as an irreversible action. The architecture is set up correctly; the sandbox's enforcement strength is the variable.

---

## The IoT Adapters: Four Protocols, One Semantic Graph

`@usir/adapters-iot` covers MQTT, CoAP, Modbus/OPC-UA, and Sensor Fusion. All four are in-memory simulations — none make real network connections — but the design of the simulation is precise enough to be instructive about the real integration shape.

### MQTT: Topics as SemanticGraph Entities

The `MqttAdapter` is the most complete of the four. It implements connection state, pub/sub with callback registration, QoS levels 0/1/2, retained message semantics, wildcard topic matching (`+` single-level, `#` multi-level), and a `TopicBridge` that maps MQTT topics to SemanticGraph entity IDs:

```typescript
export interface TopicBridge {
  topic:    string;    // e.g. 'sensor/#' or 'actuator/+/state'
  entityId: string;   // SemanticGraph entity this topic maps to
  direction: 'to-entity' | 'from-entity' | 'bidirectional';
}
```

When a message is published to a topic that matches a bridge, the adapter calls `emitEntityUpdate(entityId, payload)`. The actual implementation of that method is a single comment: `// In production, this pushes payload updates to the SemanticGraph entity`. The bridge mechanism is designed but the hook into the SemanticGraph is not wired. This is exactly the kind of honest stub that separates a research project from wishful documentation — the shape is right, the wire is not yet there.

The wildcard topic matching is correctly implemented:

```typescript
private matchesTopic(subscribedTopic: string, publishedTopic: string): boolean {
  if (subscribedTopic === publishedTopic) return true;
  const subParts = subscribedTopic.split('/');
  const pubParts = publishedTopic.split('/');
  if (subParts.length !== pubParts.length) return false;
  return subParts.every((part, i) => part === '+' || part === '#' || part === pubParts[i]);
}
```

The `#` catch-all handling has a subtle bug: MQTT spec requires `#` to match the remaining segment *including all sub-levels*, meaning `sensor/#` should match `sensor/room1/temp` even though they have different segment counts. The current implementation returns `false` for different-length topics before even checking for `#`. A test catches `sensor/+/temp` with single-level wildcards correctly, but `sensor/#` matching `sensor/room1/temp/celsius` would incorrectly return false. This is the kind of spec compliance gap that wouldn't surface until real MQTT integration tests against a live broker.

### CoAP: Resource Discovery Without a Real Stack

The `CoapAdapter` implements the CoAP resource model (RFC 7252): `discover`, `get`, `put`, `post`, `delete`, and `observe`. The observe/unobserve pattern is clean — `observe()` returns an unobscribe function, and `notifyObservers()` is a push mechanism that simulates the server-sent observation updates a real CoAP server would send.

```typescript
async observe(host: string, port: number, path: string,
              callback: (value: Buffer) => void): Promise<() => void> {
  const key = `${host}:${port}${path}`;
  if (!this.observed.has(key)) this.observed.set(key, []);
  this.observed.get(key)!.push(callback);
  return () => {
    const cbs = this.observed.get(key);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
      if (cbs.length === 0) this.observed.delete(key);
    }
  };
}
```

There is no real CoAP network stack here. A live integration would need `node-coap` or a native binding. The payload in `get()` is hardcoded to return `Buffer.from(JSON.stringify({ path, found: true }))` regardless of any actual resource state — it's just enough to test the structural protocol flow.

### Modbus and OPC-UA: The Industrial Gap

The `ModbusAdapter` is the most instructive case for understanding what "happy-path implementation" means in practice. It correctly models the Modbus register address space: coils (boolean), discrete inputs, holding registers (16-bit unsigned), and input registers. Write validation is present:

```typescript
async writeRegister(address: number, value: number): Promise<void> {
  if (!this.connected) throw new Error('Not connected to Modbus device');
  if (value < 0 || value > 65535) throw new Error('Register value must be 0-65535');
  this.holdingRegisters.set(address, value);
}
```

The OPC-UA support is bootstrapped with two hardcoded tags:

```typescript
private opcuaTags: OpcuaTag[] = [
  { nodeId: 'ns=0;i=85',   browseName: 'Server',      dataType: 'Object' },
  { nodeId: 'ns=0;i=2256', browseName: 'CurrentTime', dataType: 'DateTime' },
];
```

And `readOpcuaTag('ns=0;i=2256')` correctly returns `new Date().toISOString()` — the only dynamic behavior in the entire OPC-UA implementation. Everything else is a map lookup against this two-entry table.

Here is the honest gap analysis. A real OPC-UA server (using the `open62541` library or `node-opcua`) exposes a tree of hundreds of nodes: object types, variable types, method nodes, view nodes, data type nodes, reference type nodes. It has a security model with signing, encryption, and certificate-based authentication. Session management, subscription models for monitored items, history access — all of this is production-critical for industrial IoT and entirely absent here. This is not a criticism of the code; it's a calibration of what "pre-alpha" means in this domain specifically. Modbus/OPC-UA is a domain where the happy path and the production path diverge more than in almost any other protocol.

### Sensor Fusion: The Most Production-Ready IoT Component

The `SensorFusionAdapter` is, counterintuitively, the most production-ready component in the entire IoT package. It implements:

- Time-windowed telemetry ingestion with `ingest()` and `query()` by `sensorId`/`metric`/time range
- Statistical aggregation with `aggregate()` returning `{ count, avg, min, max, stddev }`
- Threshold alerting with `addThreshold()` / `removeThreshold()`, configurable `min`/`max` bounds, per-rule callbacks, and a `cooldownMs` debounce to prevent alert storms

The threshold system is elegant:

```typescript
addThreshold(rule: ThresholdRule): void {
  const key = `${rule.sensorId}:${rule.metric}`;
  if (!this.thresholds.has(key)) this.thresholds.set(key, []);
  this.thresholds.get(key)!.push(rule);
}
```

And after each `ingest()`, the adapter checks all matching thresholds and fires `onBreach` callbacks synchronously. The cooldown is tracked per-rule with a `lastBreachAt` timestamp — if `Date.now() - rule.lastBreachAt < rule.cooldownMs`, the callback is suppressed. This is production-quality threshold management logic. The only missing piece for real deployment is persistence (in-memory telemetry evaporates on restart) and the SQLite backend that the `InteractionMemory` subsystem already uses as a path for exactly this kind of cross-session storage.

---

## The XR Adapters: Three Primitives for Spatial Computing

`@usir/adapters-xr` covers Unity Bridge, Spatial Anchors, and XR Input. The architecture signals are more important here than the implementation details, because XR is where USIR's spatial-entity design pays off most clearly.

### UnityBridgeAdapter: The IPC Contract

The Unity Bridge supports two transport types: `'named-pipe'` and `'websocket'`. In the current implementation, both result in the same in-memory simulation — the transport type is stored but not acted on. The real behavior of a `named-pipe` transport would be a Node.js IPC socket to a local Unity process; `websocket` would be a WebSocket connection to Unity's runtime WebSocket server.

The message model is a poll-based queue of `SpatialTransform` and `XrEvent` objects:

```typescript
interface SpatialTransform {
  entityId:  string;
  position:  SpatialVec3;   // { x, y, z }
  rotation:  Quaternion;    // { x, y, z, w }
  scale:     SpatialVec3;
  timestamp: number;
}

interface XrEvent {
  type:      string;
  source:    string;
  data:      Record<string, unknown>;
  timestamp: number;
}
```

`sendTransform()` / `receiveTransforms()` and `triggerEvent()` / `pollEvents()` are drain-on-read queues. This is the right pattern for a polling integration. A real Unity integration would use a Unity C# `NetworkBehaviour` on one end and the Node.js WebSocket client on the other, with a frame protocol for transform batching. The current design doesn't constrain that implementation — it's a clean interface definition.

### SpatialAnchorAdapter: Real Math, Fake Persistence

The `SpatialAnchorAdapter` is one of the more carefully designed adapters. Anchors carry full `{ position, rotation, coordinateSystem, persistedAt, metadata }` and the query API supports both coordinate-system filtering and proximity queries:

```typescript
async queryAnchors(options?: {
  coordinateSystem?: string;
  near?: SpatialVec3;
  radius?: number;
}): Promise<SpatialAnchor[]> {
  let results = Array.from(this.anchors.values());

  if (options?.coordinateSystem) {
    results = results.filter((a) => a.coordinateSystem === options.coordinateSystem);
  }

  if (options?.near && options?.radius) {
    results = results.filter((a) => {
      const dx = a.position.x - options.near!.x;
      const dy = a.position.y - options.near!.y;
      const dz = a.position.z - options.near!.z;
      return Math.sqrt(dx*dx + dy*dy + dz*dz) <= options.radius!;
    });
  }

  return results.map((a) => ({ ...a }));
}
```

The proximity query uses real Euclidean distance in 3D. The coordinate system transformation uses a hardcoded offset table:

```typescript
private coordinateOffsets = new Map<string, SpatialVec3>([
  ['world',    { x: 0,    y: 0,   z: 0   }],
  ['room',     { x: 1,    y: 0.5, z: 0   }],
  ['tracking', { x: -0.5, y: 0,   z: 0.5 }],
]);
```

The `transformBetween('world', 'room', point)` returns `point + (worldOffset - roomOffset)`. This is demonstrative, not correct. Real spatial coordinate system transforms require quaternion-based rotation matrices, not additive offsets. A world-to-room transform for a headset involves both a translational offset (where the room origin is in world space) and a rotational offset (how the room is oriented relative to world). The current implementation is a placeholder that confirms the API shape and passes unit tests with carefully chosen test data.

### XrInputAdapter: Hand Tracking and Gaze as SemanticGraph Events

The XR input model deserves attention because it's where USIR's long-term vision is most visible. The `XrInputAdapter` returns structured hand-tracking data:

```typescript
interface HandTracking {
  handedness: 'left' | 'right';
  wrist:      SpatialVec3;
  fingers:    FingerJoint[];   // per-finger, per-joint 3D positions
  gestures:   string[];        // e.g. ['open', 'fist', 'point']
  timestamp:  number;
}

interface EyeGaze {
  origin:       SpatialVec3;
  direction:    SpatialVec3;   // unit vector, default (0, 0, -1)
  hitEntityId?: string;        // resolved from raycast
  hitPoint?:    SpatialVec3;
  timestamp:    number;
}
```

And the `EntityInteractionMapping` system allows the runtime to register handlers for specific entity IDs:

```typescript
async mapEntityInteraction(
  entityId: string,
  handler: (event: XrInteractionEvent) => void
): Promise<void> {
  if (!this.entityMappings.has(entityId)) {
    this.entityMappings.set(entityId, []);
  }
  this.entityMappings.get(entityId)!.push(handler);
}
```

When `injectInteraction()` fires with a `targetEntityId`, all registered handlers for that entity are called. This is the hook mechanism for "user points at entity X in XR space" → "USIR routes an intent targeting entity X". The `hitEntityId` on `EyeGaze` is what would be populated by a real raycast against the spatial anchor graph — when a user looks at a physical entity that has a `SpatialAnchor`, the gaze direction vector hits the anchor's `SpatialVolume`, and the resolved entity ID flows into the intent's `CognitiveReference`.

The interaction event types — `'select'`, `'grab'`, `'release'`, `'hover'`, `'gesture'` — from sources `'hand'`, `'eye'`, `'controller'` — map cleanly to USIR's L2 Navigation and L4 Manipulation intent layers. Pointing at a file in XR space and doing a pinch gesture (`select` from `hand`) routes to `intent.navigate.open`. Grabbing a 3D UI panel and moving it routes to `intent.manipulation.move`. The ontology is ahead of the implementation, which is exactly the right relationship.

---

## The Zero-Shot Adapter: Spec Without Code

The Semantic Horizon blog series starts with the most ambitious unimplemented idea in the entire USIR repo. The Zero-Shot Adapter's spec is worth reading in full — and confronting honestly.

The core insight is a reframe of how VLMs should interact with unfamiliar UIs. The current dominant approach (used by browser automation agents, computer-use APIs, and screenshot-to-click agents) feeds a live screenshot to a VLM and asks it to locate the target element and produce coordinates. The USIR design calls this "an architectural dead end" for two reasons: it re-introduces pixel-coordinate coupling (violating the intent/presentation separation) and it puts VLM latency (2–5 seconds) on the critical path of every interaction.

The proposed alternative uses the VLM as an Ahead-Of-Time compiler:

```
Zero-Shot Adapter: Compilation Flow

  Unknown Application Opens
          │
          ▼
  Ingestion: DOM scrape + A11y tree + screenshot
          │
          ▼
  VLM (one-time, expensive, ~2-5s)
  "Compile this UI to EntityRole vocabulary"
          │
          ▼
  DynamicAdapter {
    entities: [
      { selector: "#submit-btn", role: "action_target",
        maps_to_intent: "intent.execution.run" },
      { selector: "#form-name",  role: "form_field",
        maps_to_intent: "intent.manipulation.edit" },
      ...
    ],
    fingerprint: SHA256(role/label hierarchy),
  }
          │
          ▼
  Subsequent interactions: sub-16ms deterministic hook execution
  (structural hash match → use cached adapter)
          │
          ▼
  Structural change detected → partial re-compile or full VLM recall
```

The Semantic Checksumming mechanism — hashing the DOM/A11y role/label hierarchy rather than the pixel content — is the key innovation. UI layouts change frequently; semantic structure changes rarely. A button that moves from the left panel to the right still has the same `role="button"` and `aria-label="Submit"`. The fingerprint is stable across visual redesigns that don't change structure, which is the common case for mature software.

The intent mapping is the other crucial piece. The compiler doesn't just produce entity selectors — it produces intent-to-action mappings:

```json
{
  "ui_node": { "selector": "#submit-btn", "role": "button", "label": "Submit" },
  "maps_to_intent": "intent.execution.run",
  "action_metadata": { "triggers_form_validation": true }
}
```

This means the runtime can receive an `intent.execution.run` for an entity in the zero-shot adapter and know exactly which DOM element to click, without ever calling the VLM again.

The Playwright adapter (`apps/playwright/`) is described as a "zero-shot adapter prototype" in the repo structure, with 8 tools and a DOM extraction mechanism. But reading the actual Playwright adapter, it's a headless browser automation tool (navigate, click, type, extract, hover, scroll, wait) rather than a VLM-compilation pipeline. It proves that a DOM-extraction + headless-automation approach is implementable in the USIR tool model — but the "compile once with VLM, execute deterministically thereafter" architecture of the true Zero-Shot Adapter is not in code anywhere. The spec is the artifact.

This is the honest state: a fully specified design, a working adjacent prototype, and zero implementation of the compilation pipeline. The `@usir/zero-shot-adapter` package mentioned in the Semantic Horizon docs does not exist in the repo.

---

## Separating Vision from Code: A Summary

It's worth being precise about what is working code and what is spec or simulation across the entire Semantic Horizon surface:

```
Adapter Component                  Status
─────────────────────────────────  ──────────────────────────────────────
OS: SecuritySandbox                ✓ Working, real enforcement logic
OS: ProcessAdapter (list/spawn)    ✓ Real execSync / child_process
OS: FileSystemAdapter              ✓ Real fs ops, sandbox-enforced
OS: ShellAdapter (exec)            ✓ Real exec, real output
OS: WindowAdapter                  ⚠ In-memory simulation (no real WM API)
OS: ShellAdapter (pipe session)    ⚠ Spawns real shell, output not buffered
IoT: MqttAdapter                   ⚠ In-memory simulation, no network
IoT: MQTT wildcard matching        ⚠ Bug in '#' multi-level wildcard
IoT: MQTT → SemanticGraph bridge   ✗ Hook defined, not wired
IoT: CoapAdapter                   ⚠ In-memory simulation, no node-coap
IoT: ModbusAdapter (registers)     ⚠ In-memory simulation, no modbus-serial
IoT: OPC-UA (browseOpcua)          ✗ Two hardcoded nodes, not a real server
IoT: SensorFusionAdapter           ✓ Full telemetry + aggregation + alerts
XR: UnityBridgeAdapter             ⚠ Transport types defined, not wired
XR: SpatialAnchorAdapter           ⚠ Euclidean proximity real, transforms fake
XR: XrInputAdapter (hand/gaze)     ⚠ Data model real, inject/poll simulated
XR: Entity → Intent routing        ⚠ Hook exists (mapEntityInteraction), unwired
Zero-Shot Adapter                  ✗ Spec only, no code
```

The IoT and XR adapters share a common pattern: the data models are real, the connection to actual hardware is simulated, and the integration with the USIR semantic graph (the most important part) is a stubbed method. None of this is hidden — the comments say "In production, this pushes payload updates to the SemanticGraph entity" — but it means the jump from tests-passing to hardware-working is not incremental, it's a full network stack integration with all the driver complexity that entails.

---

## The Semantic Horizon Blogs: Vision as a Design Artifact

The five Semantic Horizon blog posts in `docs/semantic-horizon/` deserve reading not as documentation of working features but as a design rationale for why the adapter layer looks the way it does. Part 2 ("The Ambient Sensorium") explains the `physical_device` and `spatial_anchor` entity roles — which do appear in the XR adapter's `supportedRoles: ['spatial_anchor']`. Part 2 also specifies the `ContinuousHotBuffer` for sensor streaming and the `SpatialReference.gazeVector` field on `CognitiveReference` — neither of which appear in the current runtime code, but which clarify why the XR adapter's `EyeGaze` has `direction` and `hitEntityId` fields that currently go nowhere.

This is the function of the Semantic Horizon series: it articulates the integration contract between the adapter layer and the runtime layer in enough detail that an implementer knows exactly what to build. The IoT MQTT bridge stub isn't an accident — it's the connection point where `TopicBridge.entityId` maps to the `SemanticGraph` entity system, and the Ambient Sensorium blog is what tells you exactly what that wire should do when it exists.

The most practically significant implication is for the intent ontology. Parts 3–5 of the Semantic Horizon ("Proactive Computing", "Agentic Delegation", "The Federated Semantic Web") describe intent flows that are structurally present in the L6–L8 ontology layers but not exercised by any current adapter. L6 `environmental.sense`, L7 `delegation.delegate`, and L8 `collaboration.share` all have handlers in the federation package — but the IoT and XR adapters that would generate those intents in real deployments are simulations. The ontology is calibrated for a world that the adapters haven't reached yet.

---

## Critical Take

The OS adapter is the one to watch most carefully. The `SecuritySandbox` prefix-based path allowlist is correct in concept but incomplete in coverage — it doesn't handle symlink traversal, relative path normalization edge cases, or cross-device mounts. More importantly, it doesn't integrate with the A2U trust gate in a documented way. The blog series plan says the OS adapter goes through the normal `TrustClassifier` pipeline (irreversible actions → always prompt), but there's no code wiring `SecuritySandbox.check('denied')` → `A2UDispatcher.blocker()`. The two systems are parallel, not integrated.

The IoT adapters are the right level of ambition for a pre-alpha research project. Implementing a full MQTT stack with real broker connectivity, a real CoAP library, and a real Modbus TCP driver would be straightforward but would also obscure the architecture questions USIR is actually trying to answer. The stubs preserve the right questions for later.

The XR adapters have the most interesting gap: the coordinate system transforms. USIR's spatial entity model (introduced in Part 3 of this series) puts `spatial` coordinates on the base `SemanticEntity`. In a multi-coordinate-system XR environment — headset tracking space, room space, world space — every spatial reference in an intent needs to be resolvable to a common frame. The `SpatialAnchorAdapter.transformBetween()` method is the specified hook for this, and its current offset-based implementation is explicitly not correct for real rotation-aware transforms. Getting this right is not a minor fix — it requires integrating with the headset's spatial mapping API (ARKit on Apple, OpenXR on Meta/other), which is a platform-specific native binding problem. The architecture correctly identifies where that integration goes; filling it in is a non-trivial platform engineering task.

The Zero-Shot Adapter is the most genuinely novel idea in the entire USIR repository. The framing of VLMs as compilers rather than operators is original, architecturally sound, and practically important. Every browser automation agent that puts a VLM in the hot path of every click is making the mistake this design is designed to avoid. The Semantic Checksumming idea — hashing structural UI identity to cache compiled adapters — is the right mechanism to make the compilation cost acceptable. That this design exists as a spec and not as code is the largest single gap between what USIR is and what it could become.

---

## Code Touchpoints

- `packages/adapters-os/` — `SecuritySandbox`, `ProcessAdapter`, `FileSystemAdapter`, `WindowAdapter`, `SystemAdapter`, `ShellAdapter`. 30 tests.
- `packages/adapters-iot/` — `MqttAdapter`, `CoapAdapter`, `ModbusAdapter`, `SensorFusionAdapter`. 33 tests.
- `packages/adapters-xr/` — `UnityBridgeAdapter`, `SpatialAnchorAdapter`, `XrInputAdapter`. 20 tests.
- `docs/semantic-horizon/01-zero-shot-adapter.md` — the spec for the most important unimplemented feature.
- `docs/semantic-horizon/02-ambient-sensorium.md` — the integration contract between IoT/XR adapters and the USIR semantic graph.
- `apps/playwright/` — the adjacent working prototype that demonstrates DOM extraction in the USIR tool model.

---

*Next: [Part 14: Critical Analysis — What USIR Gets Right, What It Gets Wrong, and What It's Missing](#)*

*Thirteen parts in. This one doesn't hedge.*
