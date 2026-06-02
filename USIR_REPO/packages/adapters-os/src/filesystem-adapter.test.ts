import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';
import { FileSystemAdapter } from './filesystem-adapter';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileSystemAdapter', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'usir-fs-test-'));
  const sandbox = new SecuritySandbox({ allowedReadPaths: [tmpDir], allowedWritePaths: [tmpDir], defaultPermission: 'denied' });
  const adapter = new FileSystemAdapter(sandbox);

  it('exposes tools with correct names', () => {
    const names = adapter.getTools().map((t) => t.name);
    expect(names).toContain('os.fs.read');
    expect(names).toContain('os.fs.write');
    expect(names).toContain('os.fs.list');
    expect(names).toContain('os.fs.stat');
    expect(names).toContain('os.fs.search');
  });

  it('writes and reads a file', async () => {
    const testFile = join(tmpDir, 'test.txt');
    const writeResult = await adapter.getTools().find((t) => t.name === 'os.fs.write')!.execute({ path: testFile, content: 'hello world' });
    expect(writeResult).toHaveProperty('path', testFile);

    const readResult = await adapter.getTools().find((t) => t.name === 'os.fs.read')!.execute({ path: testFile });
    expect(readResult).toHaveProperty('content', 'hello world');
  });

  it('lists directory contents', async () => {
    const result = await adapter.getTools().find((t) => t.name === 'os.fs.list')!.execute({ path: tmpDir });
    expect(result).toHaveProperty('entries');
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it('gets file stats', async () => {
    const testFile = join(tmpDir, 'stat-test.txt');
    writeFileSync(testFile, 'stats');
    const result = await adapter.getTools().find((t) => t.name === 'os.fs.stat')!.execute({ path: testFile });
    expect(result).toHaveProperty('size');
    expect(result.isFile).toBe(true);
  });

  it('denies access outside allowed paths', async () => {
    await expect(
      adapter.getTools().find((t) => t.name === 'os.fs.read')!.execute({ path: '/etc/shadow' }),
    ).rejects.toThrow('Permission denied');
  });
});
