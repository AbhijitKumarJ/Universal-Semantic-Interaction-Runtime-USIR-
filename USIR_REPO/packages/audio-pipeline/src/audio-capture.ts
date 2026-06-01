/**
 * Audio Capture — bridges the mic (or WebSocket audio stream) to VAD + STT.
 *
 * The MVP implementation uses the Web Audio API in the renderer process.
 * Real cross-platform capture would use a VS Code extension API or a
 * native node module.
 */

import { EnergyVAD, type VADEvent } from './vad';
import type { STTProvider } from './whisper-client';

export interface AudioCaptureConfig {
  /** VAD config */
  vadConfig?: ConstructorParameters<typeof EnergyVAD>[0];
  /** Sample rate (default 16000 for Whisper) */
  sampleRate?: number;
  /** STT provider */
  stt: STTProvider;
  /** Optional language hint */
  language?: string;
  /** Optional prompt to bias Whisper (e.g. "developer voice commands") */
  prompt?: string;
  /** Called when an utterance is detected and transcribed */
  onUtterance: (text: string) => void;
  /** Called on errors */
  onError?: (error: Error) => void;
}

export class AudioCapture {
  private config: AudioCaptureConfig;
  private vad: EnergyVAD;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioBuffer: Float32Array[] = [];
  private isCapturing = false;
  private recordingStart = 0;
  private silenceStart: number | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(config: AudioCaptureConfig) {
    this.config = config;
    this.vad = new EnergyVAD(config.vadConfig);
    this.vad.onUtteranceEnd((event) => this.handleUtteranceEnd(event));
  }

  public async start(): Promise<void> {
    if (this.isCapturing) return;
    try {
      this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate ?? 16000 });
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.isCapturing = true;
      this.recordingStart = Date.now();
      this.processAudio();
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  public stop(): void {
    this.isCapturing = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

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

  private async handleUtteranceEnd(event: VADEvent): Promise<void> {
    if (this.audioBuffer.length === 0) return;
    // Concatenate all buffered audio
    const totalLength = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const concatenated = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of this.audioBuffer) {
      concatenated.set(arr, offset);
      offset += arr.length;
    }
    this.audioBuffer = [];
    // Convert Float32 to 16-bit PCM
    const pcm = this.floatTo16BitPCM(concatenated);
    try {
      const text = await this.config.stt.transcribe(Buffer.from(pcm.buffer), {
        language: this.config.language,
        prompt: this.config.prompt,
      });
      if (text.trim()) {
        this.config.onUtterance(text.trim());
      }
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]!));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }
}
