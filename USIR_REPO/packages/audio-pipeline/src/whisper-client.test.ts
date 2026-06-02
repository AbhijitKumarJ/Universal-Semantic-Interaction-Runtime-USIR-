import { describe, it, expect } from 'vitest';
import { MockWhisperClient } from './whisper-client';

describe('MockWhisperClient', () => {
  it('returns canned responses in order', async () => {
    const client = new MockWhisperClient(['hello', 'world']);
    expect(await client.transcribe()).toBe('hello');
    expect(await client.transcribe()).toBe('world');
  });

  it('cycles through responses', async () => {
    const client = new MockWhisperClient(['only']);
    expect(await client.transcribe()).toBe('only');
    expect(await client.transcribe()).toBe('only');
  });
});
