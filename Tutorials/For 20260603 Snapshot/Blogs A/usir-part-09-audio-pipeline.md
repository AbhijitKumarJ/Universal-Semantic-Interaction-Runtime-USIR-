# Part 9: The Audio Pipeline — Voice as a First-Class Citizen

> **Series:** Decoding the Post-GUI Runtime | **Act II — The Machine in Motion**
> *← [Part 8: The A2U Protocol](/part-8-a2u-protocol) | [Part 10: The VS Code Extension Anatomy](/part-10-vscode-anatomy) →*

---

Voice is not a bolt-on feature in USIR. Read the ideation conversation and it is unmistakable: the vision of a runtime that works on smartwatches, XR glasses, and earbuds without a screen is *defined* by audio being primary, not supplementary. Turn 16 of the ideation names it explicitly — "apps should work in Cursor-like AI editors with voice support" — and that constraint ripples into every architectural decision that follows.

This post follows the audio pipeline from the mic membrane to the `FusedIntent` that lands in the `LLMRouter`. It is a journey through four distinct subsystems: Voice Activity Detection, speech-to-text strategy, a genuinely clever hack to work around VS Code's extension host, and the three-channel intent fusion that turns raw speech into something the runtime can actually act on. Along the way we will hit the real battle scars, because the gap between "voice as first-class citizen" and "voice that actually works in a sandboxed editor host" is where the engineering gets interesting.

---

## The Package

The `@usir/audio-pipeline` package is 480 lines of TypeScript, 24 tests, and five source files:

```
packages/audio-pipeline/src/
├── vad.ts              # Voice Activity Detection
├── audio-capture.ts   # Web Audio API capture loop
├── whisper-client.ts  # STT provider interface + Groq client
├── local-whisper.ts   # Local whisper.cpp + FallbackWhisperClient
└── fused-intent.ts    # Three-channel intent fusion
```

The package has a single peer dependency: `@usir/protocol`. Everything else it needs — network, process spawning, file I/O — it does directly. This is the audio subsystem's isolation boundary; the rest of the runtime consumes one function and one class from this package.

---

## Stage 1: Voice Activity Detection

Before any audio reaches a transcription service, USIR must answer a hard question: *is the user speaking right now?*

This question matters for two reasons. First, cloud STT APIs like Groq and OpenAI charge per second of audio sent. Continuous streaming would be expensive and wasteful. Second, STT models perform significantly better on clean utterance segments than on stitched-together audio that includes silence, mouse clicks, and ambient keyboard noise. You want to send exactly the speech, nothing more.

USIR's solution is `EnergyVAD`, a simple but effective RMS-energy-based Voice Activity Detector in `vad.ts`:

```typescript
export const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 0.01,   // RMS threshold (0-1)
  silenceDurationMs: 700,   // Silence that triggers utterance-end
  minSpeechMs: 250,         // Minimum speech to count as utterance
};

export class EnergyVAD {
  public processFrame(samples: Float32Array): VADEvent {
    const now = Date.now();
    const rms = this.computeRMS(samples);
    const isSpeech = rms > this.config.energyThreshold;

    if (isSpeech) {
      if (this.state === 'idle' || this.state === 'silence') {
        this.state = 'listening';
        this.speechStartAt = now;
      }
      this.lastSpeechAt = now;
    } else if (this.state === 'listening' || this.state === 'speaking') {
      this.state = 'silence';
    }

    let utteranceEnd = false;
    if (this.state === 'silence' && this.speechStartAt && this.lastSpeechAt) {
      const silenceDuration = now - this.lastSpeechAt;
      if (silenceDuration >= this.config.silenceDurationMs) {
        const speechDuration = this.lastSpeechAt - this.speechStartAt;
        if (speechDuration >= this.config.minSpeechMs) {
          utteranceEnd = true;
        }
        this.state = 'idle';
      }
    }
    // ...fire listeners if utteranceEnd
  }
}
```

The state machine has four states: `idle → listening → speaking → silence`, and it fires `utteranceEnd` when two conditions are both met: the post-speech silence has lasted at least `silenceDurationMs` (700ms by default), and the preceding speech lasted at least `minSpeechMs` (250ms). The minimum speech guard filters out keyboard clicks, mouse button sounds, and brief mouth-noise that would otherwise flood the STT pipeline with empty transcriptions.

The RMS computation itself is textbook:

```typescript
private computeRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sum / samples.length);
}
```

**The trade-off in the defaults.** An energy threshold of 0.01 is quite sensitive — it will catch whispered commands but will also trip on nearby conversation or a loud mechanical keyboard. The 700ms silence window is conservative; it means the user must pause noticeably after each command before transcription fires. These values are reasonable for a solo developer in a quiet room, which is the MVP's primary environment. A real production deployment would want per-user calibration.

**What EnergyVAD is not.** The comment in `vad.ts` is honest about its own limitations:

```typescript
/**
 * Simple energy-based VAD for the MVP. Real production should use
 * WebRTC VAD or Silero VAD for accuracy.
 */
```

WebRTC VAD (part of the WebRTC library, also available as a standalone npm package) uses a statistical model trained on speech characteristics rather than raw energy. Silero VAD is a tiny LSTM neural network that runs at ~1ms per frame and is dramatically more accurate in noisy environments. The current EnergyVAD will suffice for demos and controlled environments. For the open-plan office or the XR headset in a busy room, it will misfire constantly.

---

## Stage 2: The Audio Capture Loop

`AudioCapture` in `audio-capture.ts` bridges the mic to the VAD and then to STT. It is a Web Audio API implementation — meaning it is designed to run in a browser renderer context, not in Node.js. That constraint is going to become important very shortly.

```typescript
public async start(): Promise<void> {
  this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate ?? 16000 });
  this.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });
  const source = this.audioContext.createMediaStreamSource(this.mediaStream);
  this.analyser = this.audioContext.createAnalyser();
  this.analyser.fftSize = 2048;
  source.connect(this.analyser);
  this.isCapturing = true;
  this.processAudio();
}
```

Three details worth noting. The sample rate is hardcoded at 16000 Hz. Whisper was trained on 16kHz audio — sending anything else (44.1kHz browser default, for example) either triggers a silent resampling step inside the model or degrades transcription quality. Specifying 16kHz at the `AudioContext` level lets the browser's audio stack handle the downsampling natively before USIR ever sees a sample. The `channelCount: 1` forces mono audio, halving the data size. `echoCancellation` and `noiseSuppression` are browser-native DSP that make EnergyVAD's crude threshold more reliable.

The capture loop itself runs on `requestAnimationFrame`, which means it fires at display refresh rate (~60fps). Each frame:

```typescript
private processAudio(): void {
  if (!this.isCapturing || !this.analyser) return;
  const buffer = new Float32Array(this.analyser.fftSize);
  this.analyser.getFloatTimeDomainData(buffer);
  const event = this.vad.processFrame(buffer);
  if (event.state === 'listening' || event.state === 'speaking') {
    this.audioBuffer.push(new Float32Array(buffer));
  }
  requestAnimationFrame(() => this.processAudio());
}
```

When VAD fires `utteranceEnd`, the buffered frames are concatenated, converted from `Float32` to 16-bit PCM, and sent to the STT provider:

```typescript
private floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}
```

The PCM conversion is the correct normalization — clamping to [-1, 1] before scaling to signed 16-bit integer range, with separate handling for negative samples to avoid asymmetric clipping at the boundary.

---

## Stage 3: The STT Strategy — A Three-Client Fallback Chain

USIR's speech-to-text strategy is a principled answer to three competing requirements: minimum latency, offline capability, and user privacy.

### The STTProvider Interface

The foundation is a dead-simple interface:

```typescript
export interface STTProvider {
  transcribe(
    audioBuffer: Buffer,
    options?: { language?: string; prompt?: string }
  ): Promise<string>;
}
```

Every STT implementation — cloud, local, mock — satisfies this interface. The rest of the pipeline never knows which backend is running. This is the correct abstraction: the caller wants text back from audio, and the provider contract is exactly that and nothing more.

The `prompt` field is worth noting. Whisper accepts an optional prompt string that biases the model's vocabulary toward expected content. In `extension.ts`, the prompt is:

```typescript
prompt: 'developer voice commands for IDE',
```

This nudges Whisper toward recognizing words like "refactor", "rename", "run tests", "open terminal" over phonetically similar but contextually wrong transcriptions. It is a cheap, effective way to improve accuracy for a domain-specific use case without fine-tuning.

### FastWhisperClient (Groq)

The primary cloud provider hits Groq's `whisper-large-v3-turbo` endpoint:

```typescript
export class FastWhisperClient implements STTProvider {
  constructor(private config: WhisperClientConfig) {
    this.endpoint = config.endpoint ?? 'https://api.groq.com/openai/v1/audio/transcriptions';
    this.model = config.model ?? 'whisper-large-v3-turbo';
  }

  public async transcribe(audioBuffer: Buffer, options?: { language?: string; prompt?: string }): Promise<string> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
    form.append('file', blob, 'audio.webm');
    form.append('model', this.model);
    if (options?.language) form.append('language', options.language);
    if (options?.prompt) form.append('prompt', options.prompt);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });

    const data = (await res.json()) as { text: string };
    return data.text;
  }
}
```

Groq's hardware-accelerated inference on `whisper-large-v3-turbo` delivers sub-300ms round-trip latency on typical developer utterances (3–8 seconds of audio). The comment in `whisper-client.ts` says so directly: "Groq is fastest in 2026, with sub-300ms latency." This positions the cloud path as genuinely low-latency, not just "eventually returns text."

The endpoint is configurable — passing an OpenAI-compatible URL lets you swap in any Whisper API without touching the client code.

### LocalWhisperClient

For offline and privacy-sensitive deployments, `LocalWhisperClient` spawns a local `whisper` or `whisper.cpp` binary via `child_process.spawn`:

```typescript
export class LocalWhisperClient implements STTProvider {
  async transcribe(audioBuffer: Buffer, options?: { language?: string; prompt?: string }): Promise<string> {
    const tmpDir = mkdtempSync(join(this.tempDir, 'usir-whisper-'));
    const wavPath = join(tmpDir, 'input.wav');
    try {
      const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 2);
      writeWav(wavPath, samples, 16000);
      return await this.runWhisper(wavPath, options?.language ?? this.defaultLanguage);
    } finally {
      try { unlinkSync(wavPath); } catch { /* ignore */ }
      try { unlinkSync(wavPath + '.txt'); } catch { /* ignore */ }
      try { rmdirSync(tmpDir); } catch { /* ignore */ }
    }
  }
}
```

The implementation builds a proper WAV file header — not just raw PCM — before passing the file to the binary, because both the `whisper` Python CLI and `whisper.cpp` expect a standard WAV container. The `writeWav` helper constructs the RIFF/WAVE header manually, which is about 20 lines of careful buffer offset arithmetic.

The client auto-detects whether the binary is `whisper.cpp` (by checking if the path contains `main`, `whisper.cpp`, or `ggml`) and adjusts the CLI argument format accordingly. The Python CLI and the C++ binary use different argument names for the same concepts (`--model` vs `-m`, `--output-format txt` vs `-otxt`), and `isWhisperCpp` branches on this:

```typescript
const args: string[] = cpp
  ? ['-f', wavPath, '-m', this.modelPath, '-l', language, '-otxt', '--no-prints']
  : [wavPath, '--model', this.modelPath, '--language', language, '--output-format', 'txt'];
```

### FallbackWhisperClient — The Composition Primitive

The fallback strategy is implemented as composition rather than inheritance:

```typescript
export class FallbackWhisperClient implements STTProvider {
  constructor(
    private primary: STTProvider,
    private fallback: STTProvider,
  ) {}

  async transcribe(audioBuffer: Buffer, options?: { language?: string; prompt?: string }): Promise<string> {
    try {
      return await this.primary.transcribe(audioBuffer, options);
    } catch {
      return await this.fallback.transcribe(audioBuffer, options);
    }
  }
}
```

And in `extension.ts`, the chain is wired as **local-first, cloud-backup** — the reverse of what you might expect:

```typescript
const fastWhisper = new FastWhisperClient({
  apiKey: config.get('groqApiKey') ?? process.env.GROQ_API_KEY ?? '',
});
const localWhisper = new LocalWhisperClient({
  binaryPath: config.get('localWhisperBinary') as string | undefined,
  modelPath:  config.get('localWhisperModel') as string | undefined,
});
whisperClient = new FallbackWhisperClient(localWhisper, fastWhisper);
```

`localWhisper` is the *primary*, `fastWhisper` is the *fallback*. This is the privacy-first default: audio never leaves the machine unless the local binary is unavailable or throws. Users who configure `usir.localWhisperBinary` get full offline operation. Users who only configure `usir.groqApiKey` still get a working pipeline because `LocalWhisperClient` with a default `binaryPath: 'whisper'` will throw if the binary is not on `PATH`, triggering the fallback to Groq.

The `FallbackWhisperClient` contract is intentionally narrow: it catches any exception from the primary and retries on the fallback. It does not distinguish "primary had a network error" from "primary binary not found" — both are treated as "try fallback." This is correct for the MVP. A production implementation would want to at least log which branch fired, and potentially surface the fallback to the user so they know their audio went to a cloud service.

---

## The VS Code Extension Host Problem

Here is where the architecture has to work around a real platform constraint.

The VS Code extension host runs in a dedicated Node.js process — not in a browser renderer. This means `AudioContext`, `navigator.mediaDevices`, and `requestAnimationFrame` are simply not available there. The entire `AudioCapture` class, built on Web Audio API, is useless in the extension host.

The naive solution would be to use a native Node.js audio library (like `node-microphone` or `portaudio` bindings). But native modules in VS Code extensions are a serious maintenance burden: they must be compiled for each Node.js version that VS Code ships, for each platform, and bundled correctly. The VS Code extension packaging system does not make this easy.

USIR's solution is architectural and elegant: **move the audio capture into a webview**.

VS Code webviews run in Chromium renderer contexts — they have full Web Audio API access. The extension host can create a webview, inject JavaScript that captures audio, and communicate results back to the extension host via `postMessage` IPC. The audio never travels over a network; it travels over a synchronous in-process message channel.

```
Mic → [Webview: Web Audio API + VAD + PCM encode] → postMessage → [Extension Host: STT → FusedIntent → LLMRouter]
```

The implementation is `WebviewAudioCapture` in `apps/vscode-extension/src/audio/webview-audio-capture.ts`. When `start()` is called, it creates a hidden webview panel:

```typescript
this.panel = vscode.window.createWebviewPanel(
  'usir-audio-capture',
  'USIR Audio',
  { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
  {
    enableScripts: true,
    retainContextWhenHidden: true,  // Keep JS alive even when panel is not visible
  },
);
```

`retainContextWhenHidden: true` is critical. Without it, VS Code destroys the webview's JavaScript context when the panel is hidden, which would terminate the audio capture loop silently. With it, the webview continues running even when the panel is not in the viewport.

The webview HTML injects a complete standalone JavaScript module — no framework, no build step — that implements the same VAD logic from `vad.ts`, re-written in vanilla JS because the webview cannot import npm modules:

```javascript
const VAD_CONFIG = {
  energyThreshold: 0.01,
  silenceDurationMs: 700,
  minSpeechMs: 250
};

function computeRMS(samples) {
  var sum = 0;
  for (var i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
```

When the VAD fires utterance-end, the webview PCM-encodes the buffered audio and fires it to the extension host:

```javascript
var pcm = floatTo16BitPCM(concatenated);
vscode.postMessage({
  type: 'pcm',
  data: new Uint8Array(pcm.buffer)
});
```

The extension host receives this message, wraps it in a Node.js `Buffer`, and routes it directly to the STT provider:

```typescript
this.panel.webview.onDidReceiveMessage(async (message) => {
  if (message.type === 'pcm') {
    const uint8 = message.data as Uint8Array;
    const buffer = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    const text = await this.config.stt.transcribe(buffer, {
      language: this.config.language,
      prompt: this.config.prompt,
    });
    if (text.trim()) {
      this.config.onUtterance(text.trim());
    }
  }
});
```

The handshake sequence is also important. The webview posts `{ type: 'status', status: 'ready' }` when its script initializes, and the extension host waits for this before sending `{ type: 'start' }`. This prevents the race condition where the extension host tells the webview to start before the webview's event listener is registered.

**This is a real battle scar.** The codebase comment acknowledges it:

```
// Fix audio capture for Node.js extension host → hidden webview with postMessage IPC ✅
```

The duplication of VAD logic between `vad.ts` (used in browser and test contexts) and the inline webview JavaScript (used in VS Code) is an acknowledged technical debt. Ideally, the webview would load `vad.ts` as a bundled module. That would require the webview HTML to use a script tag pointing to a VS Code extension resource URI, which is solvable but adds build complexity. For now, the inline duplication is an acceptable trade-off.

---

## Stage 4: FusedIntent — Three Channels, One Signal

The audio pipeline's final output is not a string. It is a `FusedIntent`.

The insight behind `FusedIntent` is that a voice command is almost never purely linguistic. "Open *this*" requires knowing what "this" refers to. "Rename that to `userId`" requires knowing which identifier is in focus. A system that treats `rawText` as the only input will fail on these commands constantly. A system that fuses voice with pointing context and implicit cognitive signals can resolve them reliably.

```typescript
export interface FusedIntent {
  linguisticInput: string;                // "rename this to userId"
  pointingTarget: PointingTarget | null;  // {entityId: 'file:///src/types.ts:L42'}
  implicitSignals: ImplicitSignals;       // {typingCadence: 'halted', cursorDwellTimeMs: 4200}
  fusedAt: number;                        // epoch ms
  sources: Array<'voice' | 'text' | 'gaze' | 'mouse' | 'touch' | 'wearable'>;
  speakerId?: string;
  fusionConfidence: number;
}
```

**Channel 1: Linguistic.** The raw Whisper transcript. This is the intent verb and arguments. The `LLMRouter` will parse this into a structured intent.

**Channel 2: Pointing.** The entity the user's cursor was on — or, for gaze-tracked XR devices, the entity the user was looking at — at the moment of the command. This comes directly from the snapshot Hot tier (see Part 4), which is guaranteed to be ≤16ms stale. In `extension.ts`:

```typescript
const pointingTarget: PointingTarget | null = snapshotEngine.hot.pointerTarget
  ? {
      entityId: snapshotEngine.hot.pointerTarget.entityId,
      bounds: snapshotEngine.hot.pointerTarget.bounds,
      confidence: 1.0,
      dwellTimeMs: 0,
    }
  : null;
```

The `PointingTarget` carries not just the entity ID but its spatial bounds at the moment of the command. This matters for XR and spatial computing scenarios where multiple entities may overlap in screen space.

**Channel 3: Implicit signals.** The cognitive state of the user, inferred from behavioral signals:

```typescript
export interface ImplicitSignals {
  typingCadence?: 'flow' | 'erratic' | 'halted' | 'idle';
  cursorDwellTimeMs?: number;
  editsPerMinute?: number;
  affectiveMarker?: 'confused' | 'frustrated' | 'focused' | 'curious';
  gazeStabilityScore?: number;          // wearable-derived
  timeSinceLastInteractionMs?: number;
}
```

The `typingCadence` field is the most interesting. A user who has been typing fluidly ("flow") and then says "rename this" is making a deliberate focused request. A user who has been typing "erratically" and says "help me with this function" is probably confused and wants explanation, not execution. The implicit channel is how USIR begins to distinguish these without requiring the user to explicitly state their context.

In the current VS Code implementation, `typingCadence` and `cursorDwellTimeMs` are hardcoded stubs (`'idle'` and `0`). The `affectiveMarker`, `gazeStabilityScore`, and wearable fields require external data sources that the MVP does not yet have. They are defined in the protocol now so that future adapters can populate them without a breaking schema change.

**Building the FusedIntent:**

```typescript
const fused = buildFusedIntent({
  linguisticInput: rawInstruction,
  pointingTarget,
  implicitSignals,
  sources: ['voice', 'mouse'],
  fusionConfidence: 1.0,
});
```

The `fusionConfidence` field is currently always `1.0` from the extension, but the field exists for scenarios where confidence is genuinely uncertain — for example, when Whisper's own confidence score is below a threshold (the current implementation does not surface this from the API response), or when the pointing target entity has been out of view for longer than the dwell window.

---

## The Full Pipeline in Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USIR Audio Pipeline                                 │
│                                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │    Mic   │    │   Webview    │    │        Extension Host            │  │
│  │          │    │  (Chromium)  │    │          (Node.js)               │  │
│  └────┬─────┘    └──────┬───────┘    └──────────────┬───────────────────┘  │
│       │                 │                           │                      │
│       │  getUserMedia() │                           │                      │
│       │────────────────>│                           │                      │
│       │  MediaStream    │  createWebviewPanel()     │                      │
│       │<────────────────│<──────────────────────────│                      │
│       │                 │                           │                      │
│       │  Float32 frames │                           │                      │
│       │────────────────>│                           │                      │
│       │                 │ EnergyVAD                 │                      │
│       │                 │  processFrame()           │                      │
│       │                 │ [accumulate frames]       │                      │
│       │                 │                           │                      │
│       │                 │ utteranceEnd!             │                      │
│       │                 │ floatTo16BitPCM()         │                      │
│       │                 │ postMessage({type:'pcm'}) │                      │
│       │                 │──────────────────────────>│                      │
│       │                 │                           │ STTProvider          │
│       │                 │                           │ .transcribe(pcm)     │
│       │                 │                           │                      │
│       │                 │     ┌─────────────────────┤                      │
│       │                 │     │  LocalWhisperClient │                      │
│       │                 │     │   (primary)         │                      │
│       │                 │     │  spawn whisper.cpp  │                      │
│       │                 │     │  → text             │                      │
│       │                 │     │  [throws if missing]│                      │
│       │                 │     │  fallback ↓         │                      │
│       │                 │     │  FastWhisperClient  │                      │
│       │                 │     │  Groq API           │                      │
│       │                 │     │  → text             │                      │
│       │                 │     └─────────────────────┤                      │
│       │                 │                           │                      │
│       │                 │                           │ buildFusedIntent()   │
│       │                 │                           │ + Hot tier snapshot  │
│       │                 │                           │ → FusedIntent        │
│       │                 │                           │                      │
│       │                 │                           │ LLMRouter.route()    │
│       │                 │                           │ → ExecutionPlan      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Disambiguation via Voice

What happens when `FusedIntent` arrives at the LLM router and the intent cannot be resolved unambiguously?

Part 6 covered `InteractionWaypoint` in the context of memory. The audio pipeline has a specific concern: disambiguating via voice on headless or screenless devices. When the runtime emits an `Ambiguity` object with multiple `InteractionWaypoint` candidates, the waypoint system can generate a voice-friendly prompt.

The design spec in the repository gives a concrete example:

> *"2. The audio says it aloud. Using the NATO phonetic alphabet (Alpha, Bravo, Charlie) avoids ambiguity in voice input. 'C' and 'B' and 'D' are notoriously hard to distinguish over audio; 'Alpha', 'Bravo', 'Charlie' are not."*

The user says "rename this," two entities are candidates, the runtime speaks: *"Did you mean the `userId` parameter — Alpha — or the `user_id` column — Bravo?"*. The user responds "Alpha" and the intent resolves.

For headless devices (the smartwatch or earbuds scenario), the spec includes a DTMF fallback — the user presses a hardware button to select. This means the same disambiguation flow works across a VS Code webview (click a button), a voice channel (speak the option letter), and a hardware device (press a button). The `InteractionWaypoint` abstraction earns its keep here: all three renderers consume the same payload.

This disambiguation path is specified in the architecture but not fully implemented in the current codebase — the waypoint rendering in the VS Code extension covers the UI case but the voice-playback path requires TTS integration that is not yet wired.

---

## Critical Take: The Cold-Start Problem

The critical take from the series plan is worth quoting directly, because it describes a real product problem that the architecture currently papers over:

> *The local Whisper fallback is a significant privacy improvement, but it creates a silent cold-start problem: on first invocation, the binary must be present and the model must be loaded. In a VS Code extension, this can add 2–10 seconds of latency on first use — which is exactly the wrong moment to be slow. A lazy-load strategy (load model on extension activation, not on first intent) is the correct mitigation and does not appear to be implemented yet.*

Let us be precise about what "cold-start" means here. There are actually *two* distinct cold-start costs that compound:

**Cost 1: Whisper model load.** The `whisper-base` model is ~142MB. Loading it into memory and running the initialization pass on the first inference takes 1–3 seconds on a modern laptop. `whisper-large-v3-turbo` is ~1.5GB; first-inference load can take 5–8 seconds.

**Cost 2: The Cold tier snapshot.** The `handleInstruction` function in `extension.ts` calls `snapshotEngine.assemble(false)`, which on a fresh session triggers a full `BoundedFileSystemWalker` traversal to build the Cold tier context for the LLM router. For large projects this can take 2–4 seconds.

**Cost 3: The LLM router call.** A single GPT-4 class call with the Cold tier snapshot as context adds another 1–3 seconds.

First-command latency is realistically 5–15 seconds, depending on which Whisper backend is used and how large the project is. For comparison, Siri and Alexa deliver sub-500ms first-response times. A user who says "rename this" and waits 10 seconds for nothing visible to happen will conclude the extension is broken and uninstall it.

The correct mitigations exist but are not yet implemented:

1. **Lazy-load the Whisper model at extension activation**, not at first intent. The extension currently initializes `LocalWhisperClient` as an object at activation but does not warm up the model. Sending a null audio frame during `activate()` would trigger the model load in the background without blocking the user.

2. **Pre-warm the Cold tier snapshot** when the extension activates, not when the first intent fires. The snapshot engine currently takes the Cold tier snapshot on-demand. Running it eagerly at activation, with the result cached, would eliminate Cost 2 for first-command scenarios.

3. **Show a progress indicator.** The current status bar item shows `$(mic) USIR` but gives no feedback during the 5–15 second cold-start window. A spinner with "Warming up..." is the minimum viable UX.

These are not architectural changes — the structure already supports all three. They are implementation completeness gaps.

---

## What the 24 Tests Cover

The `@usir/audio-pipeline` test suite has 24 tests across four files. The coverage is concentrated on the components that can be unit-tested in a Node.js environment:

- `vad.test.ts` (5 tests): idle state, speech detection, RMS computation, utterance-end timing, listener callbacks. All pure unit tests.
- `fused-intent.test.ts` (3 tests): field construction, null pointing target, custom fusion confidence. Pure unit tests.
- `local-whisper.test.ts` (14 tests): mock `spawn`, WAV writing, binary detection, CLI argument formatting, error handling, fallback chain logic.
- `whisper-client.test.ts` (2 tests): `MockWhisperClient` response cycling.

What is notably absent: there are no integration tests against the real Groq or OpenAI endpoints (expected — API keys in CI are a bad idea), no tests of the `AudioCapture` class (it depends on `AudioContext` and `MediaDevices`, which are not available in Vitest/Node.js without a browser environment), and no end-to-end test that exercises the full webview IPC path. The `WebviewAudioCapture` class has zero test coverage — it is tested manually.

---

## Where Voice Goes Next

The audio pipeline as implemented is a solid MVP foundation. The `STTProvider` interface is clean; the fallback chain is correct; the webview hack solves the Node.js constraint without native modules. But the design spec points to where it needs to go.

The `ImplicitSignals` interface, with its `gazeStabilityScore`, `editsPerMinute`, and `affectiveMarker` fields, is the hook for a much more ambitious future. The Semantic Horizon section of the repo describes this explicitly:

> *The audio pipeline and the input adapters (XR headset, smart watch, OS) continuously feed this data into the runtime. By upgrading the FusedIntent with physiological and cognitive signals, and adding the PredictiveExecutionEngine gated by the AffectiveSubstrate, USIR moves from being a tool you use to an environment you inhabit.*

That is the long-term vision: a runtime that knows not just what you said, but how you were thinking when you said it. The `FusedIntent` struct is the right shape for that future. The implementation today populates two of its seven meaningful fields. The remaining five are placeholder contracts waiting for the adapters — wearables, gaze trackers, OS-level input telemetry — that will eventually fill them.

The audio pipeline is, in this sense, exactly what USIR as a whole is: architecturally complete at the schema level, partially implemented at the execution level, and pointing with unusual clarity toward the frontier it is trying to reach.

---

*Next: **[Part 10: The VS Code Extension Anatomy](/part-10-vscode-anatomy)** — how `extension.ts` wires every subsystem we have covered into a coherent, deployable extension, and why it is simultaneously the best proof-of-concept USIR has and the place where every architectural trade-off comes due at once.*

---

**Code touchpoints for this post:**
- `packages/audio-pipeline/src/vad.ts`
- `packages/audio-pipeline/src/audio-capture.ts`
- `packages/audio-pipeline/src/whisper-client.ts`
- `packages/audio-pipeline/src/local-whisper.ts`
- `packages/audio-pipeline/src/fused-intent.ts`
- `apps/vscode-extension/src/audio/webview-audio-capture.ts`
- `apps/vscode-extension/src/extension.ts` (lines: `handleInstruction`, whisper init)
