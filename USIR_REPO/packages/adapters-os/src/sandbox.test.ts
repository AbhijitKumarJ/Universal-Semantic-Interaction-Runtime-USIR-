import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';

describe('SecuritySandbox', () => {
  it('grants access to allowed read paths', () => {
    const sandbox = new SecuritySandbox({ allowedReadPaths: ['/home/user'], defaultPermission: 'prompt' });
    const status = sandbox.check({ action: 'read_file', path: '/home/user/doc.txt', reason: 'Read doc' });
    expect(status).toBe('granted');
  });

  it('denies access to non-allowed read paths with prompt default', () => {
    const sandbox = new SecuritySandbox({ allowedReadPaths: ['/home/user'], defaultPermission: 'denied' });
    const status = sandbox.check({ action: 'read_file', path: '/etc/passwd', reason: 'Read passwd' });
    expect(status).toBe('denied');
  });

  it('denies write to non-allowed paths', () => {
    const sandbox = new SecuritySandbox({ allowedWritePaths: ['/tmp'], defaultPermission: 'denied' });
    const status = sandbox.check({ action: 'write_file', path: '/etc/config', reason: 'Write config' });
    expect(status).toBe('denied');
  });

  it('grants write to allowed paths', () => {
    const sandbox = new SecuritySandbox({ allowedWritePaths: ['/tmp'], defaultPermission: 'denied' });
    const status = sandbox.check({ action: 'write_file', path: '/tmp/test.txt', reason: 'Write test' });
    expect(status).toBe('granted');
  });

  it('denies dangerous commands', () => {
    const sandbox = new SecuritySandbox({ defaultPermission: 'granted' });
    const status = sandbox.check({ action: 'execute_command', command: 'rm -rf /', reason: 'Remove root' });
    expect(status).toBe('denied');
  });

  it('caches permission results', () => {
    const sandbox = new SecuritySandbox({ allowedReadPaths: ['/tmp'], defaultPermission: 'denied' });
    const first = sandbox.check({ action: 'read_file', path: '/tmp/test.txt', reason: 'First' });
    expect(first).toBe('granted');
    const cached = sandbox.check({ action: 'read_file', path: '/tmp/test.txt', reason: 'Cached' });
    expect(cached).toBe('granted');
  });

  it('allows explicit grant and deny', () => {
    const sandbox = new SecuritySandbox({ defaultPermission: 'prompt' });
    sandbox.grant({ action: 'read_file', path: '/sensitive', reason: 'Grant' });
    expect(sandbox.check({ action: 'read_file', path: '/sensitive', reason: 'Check' })).toBe('granted');
    sandbox.deny({ action: 'read_file', path: '/blocked', reason: 'Deny' });
    expect(sandbox.check({ action: 'read_file', path: '/blocked', reason: 'Check' })).toBe('denied');
  });

  it('resets cached permissions', () => {
    const sandbox = new SecuritySandbox({ allowedReadPaths: ['/tmp'], defaultPermission: 'denied' });
    sandbox.check({ action: 'read_file', path: '/tmp/test.txt', reason: 'First' });
    sandbox.reset();
    const status = sandbox.check({ action: 'read_file', path: '/tmp/test.txt', reason: 'After reset' });
    expect(status).toBe('granted');
  });

  it('returns prompt when default is prompt and no rules match', () => {
    const sandbox = new SecuritySandbox({ defaultPermission: 'prompt' });
    const status = sandbox.check({ action: 'access_clipboard', reason: 'Access clipboard' });
    expect(status).toBe('prompt');
  });
});
