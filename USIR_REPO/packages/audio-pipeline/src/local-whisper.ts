import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, rmdirSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { STTProvider } from './whisper-client';

export interface LocalWhisperConfig {
  /** Path to whisper binary (default: auto-detect 'whisper' CLI) */
  binaryPath?: string;
  /** Model path or model name (default: 'base') */
  modelPath?: string;
  /** Language hint (default: 'en') */
  language?: string;
  /** Temp directory for audio files (default: os.tmpdir()) */
  tempDir?: string;
  /** Additional CLI arguments */
  extraArgs?: string[];
}

function writeWav(filePath: string, samples: Int16Array, sampleRate: number): void {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
}

function isWhisperCpp(binaryPath: string): boolean {
  const name = binaryPath.toLowerCase();
  return name.includes('main') || name.includes('whisper.cpp') || name.endsWith('ggml');
}

export class LocalWhisperClient implements STTProvider {
  private binaryPath: string;
  private modelPath: string;
  private defaultLanguage: string;
  private tempDir: string;
  private extraArgs: string[];

  constructor(config: LocalWhisperConfig = {}) {
    this.binaryPath = config.binaryPath ?? 'whisper';
    this.modelPath = config.modelPath ?? 'base';
    this.defaultLanguage = config.language ?? 'en';
    this.tempDir = config.tempDir ?? tmpdir();
    this.extraArgs = config.extraArgs ?? [];
  }

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

  private runWhisper(wavPath: string, language: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const cpp = isWhisperCpp(this.binaryPath);
      const args: string[] = cpp
        ? ['-f', wavPath, '-m', this.modelPath, '-l', language, '-otxt', '--no-prints']
        : [wavPath, '--model', this.modelPath, '--language', language, '--output-format', 'txt'];

      args.push(...this.extraArgs);

      let proc;
      try {
        proc = spawn(this.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(new Error(`Failed to spawn whisper binary "${this.binaryPath}": ${(err as Error).message}`));
        return;
      }

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Whisper exit code ${code}: ${stderr.trim() || stdout.trim() || 'unknown error'}`));
          return;
        }
        try {
          const txtPath = wavPath + '.txt';
          const result = readFileSync(txtPath, 'utf-8').trim();
          resolve(result || stdout.trim());
        } catch {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn whisper binary "${this.binaryPath}": ${err.message}`));
      });
    });
  }
}

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
