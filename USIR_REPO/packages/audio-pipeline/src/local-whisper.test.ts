import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FallbackWhisperClient, LocalWhisperClient } from './local-whisper';
import { MockWhisperClient } from './whisper-client';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/usir-whisper-test-xxxx'),
}));

const pcm16Buffer = Buffer.alloc(32000); // 1 sec of 16kHz 16-bit mono silence

function mockSpawn(stdout: string, stderr = '', exitCode = 0) {
  const mockProc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };
  mockProc.stdout.on.mockImplementation((_event: string, cb: (d: Buffer) => void) => {
    if (stdout) cb(Buffer.from(stdout));
  });
  mockProc.stderr.on.mockImplementation((_event: string, cb: (d: Buffer) => void) => {
    if (stderr) cb(Buffer.from(stderr));
  });
  mockProc.on.mockImplementation((event: string, cb: (code?: number) => void) => {
    if (event === 'close') cb(exitCode);
    if (event === 'error') { /* no error */ }
  });
  vi.mocked(spawn).mockReturnValue(mockProc as any);
}

describe('LocalWhisperClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // readFileSync mock to simulate .txt output file
    vi.mocked(readFileSync).mockReturnValue(' hello world ');
  });

  it('spawns whisper CLI with correct args by default', async () => {
    mockSpawn('transcribing...', '', 0);
    const client = new LocalWhisperClient();
    const result = await client.transcribe(pcm16Buffer);
    expect(result).toBe('hello world');
    expect(spawn).toHaveBeenCalledWith(
      'whisper',
      expect.arrayContaining([expect.stringContaining('.wav'), '--model', 'base']),
      expect.any(Object),
    );
  });

  it('spawns whisper.cpp binary with -f and -m flags', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient({ binaryPath: './whisper.cpp/main' });
    await client.transcribe(pcm16Buffer);
    expect(spawn).toHaveBeenCalledWith(
      './whisper.cpp/main',
      expect.arrayContaining(['-f', expect.stringContaining('.wav'), '-m', 'base']),
      expect.any(Object),
    );
  });

  it('detects whisper.cpp binary by name containing "main"', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient({ binaryPath: 'main' });
    await client.transcribe(pcm16Buffer);
    expect(spawn).toHaveBeenCalledWith(
      'main',
      expect.arrayContaining(['-f']),
      expect.any(Object),
    );
  });

  it('passes extraArgs to the binary', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient({ extraArgs: ['--threads', '4'] });
    await client.transcribe(pcm16Buffer);
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toContain('--threads');
    expect(args).toContain('4');
  });

  it('rejects when process exits with non-zero code', async () => {
    mockSpawn('', 'model not found', 1);
    const client = new LocalWhisperClient();
    await expect(client.transcribe(pcm16Buffer)).rejects.toThrow('model not found');
  });

  it('rejects when spawn throws', async () => {
    vi.mocked(spawn).mockImplementation(() => { throw new Error('ENOENT'); });
    const client = new LocalWhisperClient();
    const client2 = new LocalWhisperClient({ binaryPath: '/nonexistent/whisper' });
    await expect(client2.transcribe(pcm16Buffer)).rejects.toThrow('Failed to spawn');
  });

  it('cleans up temp files after transcription', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient();
    await client.transcribe(pcm16Buffer);
    expect(unlinkSync).toHaveBeenCalled();
    expect(rmdirSync).toHaveBeenCalled();
  });

  it('passes language option to transcribe', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient();
    await client.transcribe(pcm16Buffer, { language: 'fr' });
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toContain('fr');
  });

  it('uses default language when none provided', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient({ language: 'de' });
    await client.transcribe(pcm16Buffer);
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toContain('de');
  });

  it('writes a valid WAV file to temp dir', async () => {
    mockSpawn('', '', 0);
    const client = new LocalWhisperClient();
    await client.transcribe(pcm16Buffer);
    expect(writeFileSync).toHaveBeenCalledOnce();
    const wavPath = vi.mocked(writeFileSync).mock.calls[0][0] as string;
    expect(wavPath).toContain('.wav');
    const wavBuffer = vi.mocked(writeFileSync).mock.calls[0][1] as Buffer;
    expect(wavBuffer.length).toBeGreaterThan(44);
    expect(wavBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wavBuffer.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('falls back to stdout when .txt output file is missing', async () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    mockSpawn('direct stdout text', '', 0);
    const client = new LocalWhisperClient();
    const result = await client.transcribe(pcm16Buffer);
    expect(result).toBe('direct stdout text');
  });
});

describe('FallbackWhisperClient', () => {
  it('returns primary result when primary succeeds', async () => {
    const primary = new MockWhisperClient(['primary result']);
    const fallback = new MockWhisperClient(['fallback']);
    const client = new FallbackWhisperClient(primary, fallback);
    const result = await client.transcribe(Buffer.alloc(100));
    expect(result).toBe('primary result');
  });

  it('falls back to secondary when primary fails', async () => {
    const primary = new MockWhisperClient(['']);
    const fallback = new MockWhisperClient(['fallback result']);
    const spy = vi.spyOn(primary, 'transcribe').mockRejectedValue(new Error('primary down'));
    const client = new FallbackWhisperClient(primary, fallback);
    const result = await client.transcribe(Buffer.alloc(100));
    expect(result).toBe('fallback result');
    spy.mockRestore();
  });

  it('throws when both providers fail', async () => {
    const primary = new MockWhisperClient(['']);
    const fallback = new MockWhisperClient(['']);
    vi.spyOn(primary, 'transcribe').mockRejectedValue(new Error('fail1'));
    vi.spyOn(fallback, 'transcribe').mockRejectedValue(new Error('fail2'));
    const client = new FallbackWhisperClient(primary, fallback);
    await expect(client.transcribe(Buffer.alloc(100))).rejects.toThrow('fail2');
  });
});
