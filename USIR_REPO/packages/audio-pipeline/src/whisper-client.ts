/**
 * Whisper STT client — fast transcription for audio-native interaction.
 *
 * The MVP uses a remote provider (Groq is fastest in 2026, with sub-300ms
 * latency). Real production should support local Whisper.cpp fallback
 * for offline use.
 */

export interface STTProvider {
  transcribe(audioBuffer: Buffer, options?: { language?: string; prompt?: string }): Promise<string>;
}

export interface WhisperClientConfig {
  apiKey: string;
  /** Default: Groq's endpoint. Override for OpenAI or local. */
  endpoint?: string;
  model?: string;
}

export class FastWhisperClient implements STTProvider {
  private endpoint: string;
  private model: string;

  constructor(private config: WhisperClientConfig) {
    this.endpoint = config.endpoint ?? 'https://api.groq.com/openai/v1/audio/transcriptions';
    this.model = config.model ?? 'whisper-large-v3-turbo';
  }

  public async transcribe(audioBuffer: Buffer, options?: { language?: string; prompt?: string }): Promise<string> {
    const form = new FormData();
    // Convert Buffer to Uint8Array → Blob for FormData
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
    form.append('file', blob, 'audio.webm');
    form.append('model', this.model);
    if (options?.language) form.append('language', options.language);
    if (options?.prompt) form.append('prompt', options.prompt);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      throw new Error(`Whisper transcription failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { text: string };
    return data.text;
  }
}

/**
 * Mock implementation for testing — returns canned responses after a small delay.
 */
export class MockWhisperClient implements STTProvider {
  private responses: string[];
  private index = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  public async transcribe(): Promise<string> {
    await new Promise((r) => setTimeout(r, 50));
    const response = this.responses[this.index % this.responses.length]!;
    this.index++;
    return response;
  }
}
