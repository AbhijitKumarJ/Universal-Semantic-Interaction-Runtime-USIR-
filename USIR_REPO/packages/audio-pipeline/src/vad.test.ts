import { describe, it, expect } from 'vitest';
import { EnergyVAD } from './vad';

function makeFrame(rms: number, length = 160): Float32Array {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = rms;
  }
  return samples;
}

describe('EnergyVAD', () => {
  it('starts in idle state', () => {
    const vad = new EnergyVAD();
    expect(vad.processFrame(makeFrame(0)).state).toBe('idle');
  });

  it('transitions to listening when speech detected', () => {
    const vad = new EnergyVAD({ energyThreshold: 0.01 });
    const event = vad.processFrame(makeFrame(0.1));
    expect(event.state).toBe('listening');
  });

  it('computes RMS correctly', () => {
    const vad = new EnergyVAD({ energyThreshold: 0.01 });
    // Silence
    const silent = vad.processFrame(makeFrame(0));
    expect(silent.state).toBe('idle');
    // Speech
    const speech = vad.processFrame(makeFrame(0.5));
    expect(speech.state).toBe('listening');
  });

  it('detects utterance end after silence', () => {
    const vad = new EnergyVAD({ energyThreshold: 0.01, silenceDurationMs: 0, minSpeechMs: 0 });
    vad.processFrame(makeFrame(0.1));
    const event = vad.processFrame(makeFrame(0));
    expect(event.utteranceEnd).toBe(true);
  });

  it('calls listeners on utterance end', () => {
    const vad = new EnergyVAD({ energyThreshold: 0.01, silenceDurationMs: 0, minSpeechMs: 0 });
    let called = false;
    vad.onUtteranceEnd(() => { called = true; });
    vad.processFrame(makeFrame(0.1));
    vad.processFrame(makeFrame(0));
    expect(called).toBe(true);
  });
});
