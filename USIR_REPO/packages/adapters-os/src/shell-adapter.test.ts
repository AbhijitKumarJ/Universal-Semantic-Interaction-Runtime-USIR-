import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';
import { ShellAdapter } from './shell-adapter';

describe('ShellAdapter', () => {
  const sandbox = new SecuritySandbox({ defaultPermission: 'granted' });
  const adapter = new ShellAdapter(sandbox);

  it('exposes shell exec tool', () => {
    const names = adapter.getTools().map((t) => t.name);
    expect(names).toContain('os.shell.exec');
    expect(names).toContain('os.shell.pipe');
  });

  it('executes a command and returns output', async () => {
    const result = await adapter.getTools().find((t) => t.name === 'os.shell.exec')!.execute({ command: 'echo hello' });
    expect(result).toHaveProperty('stdout', 'hello');
    expect(result).toHaveProperty('exitCode', 0);
  });

  it('returns stderr on failed command', async () => {
    const result = await adapter.getTools().find((t) => t.name === 'os.shell.exec')!.execute({ command: 'nonexistent_cmd_xyz' });
    expect(result.exitCode).not.toBe(0);
  });

  it('denies on permission failure', async () => {
    const restricted = new SecuritySandbox({ defaultPermission: 'denied' });
    const restrictedAdapter = new ShellAdapter(restricted);
    await expect(
      restrictedAdapter.getTools().find((t) => t.name === 'os.shell.exec')!.execute({ command: 'echo test' }),
    ).rejects.toThrow('Permission denied');
  });
});
