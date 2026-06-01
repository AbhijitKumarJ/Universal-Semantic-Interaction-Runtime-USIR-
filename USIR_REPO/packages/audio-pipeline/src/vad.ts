/**
 * Voice Activity Detection (VAD).
 *
 * Simple energy-based VAD for the MVP. Real production should use
 * WebRTC VAD or Silero VAD for accuracy.
 */

export interface VADConfig {
  /** RMS energy threshold (0-1) */
  energyThreshold: number;
  /** ms of silence before triggering end-of-speech */
  silenceDurationMs: number;
  /** ms minimum speech duration to count as utterance */
  minSpeechMs: number;
}

const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 0.01,
  silenceDurationMs: 700,
  minSpeechMs: 250,
};

export type VADState = 'idle' | 'listening' | 'speaking' | 'silence';

export interface VADEvent {
  state: VADState;
  /** True if this is the end of an utterance */
  utteranceEnd: boolean;
  /** Duration of detected speech so far (ms) */
  speechDurationMs: number;
  timestamp: number;
}

export class EnergyVAD {
  private config: VADConfig;
  private state: VADState = 'idle';
  private speechStartAt: number | null = null;
  private lastSpeechAt: number | null = null;
  private listeners: Array<(event: VADEvent) => void> = [];

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  /**
   * Feed an audio frame (Float32Array of samples in [-1, 1]).
   * Returns the VAD event for this frame.
   */
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
        this.speechStartAt = null;
        this.lastSpeechAt = null;
      }
    }

    const event: VADEvent = {
      state: this.state,
      utteranceEnd,
      speechDurationMs: this.speechStartAt && this.lastSpeechAt ? this.lastSpeechAt - this.speechStartAt : 0,
      timestamp: now,
    };

    if (utteranceEnd) {
      for (const listener of this.listeners) listener(event);
    }
    return event;
  }

  public onUtteranceEnd(listener: (event: VADEvent) => void): void {
    this.listeners.push(listener);
  }

  private computeRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i]! * samples[i]!;
    }
    return Math.sqrt(sum / samples.length);
  }
}
