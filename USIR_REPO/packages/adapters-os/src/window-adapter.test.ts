import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';
import { WindowAdapter } from './window-adapter';

describe('WindowAdapter', () => {
  const sandbox = new SecuritySandbox({ defaultPermission: 'granted' });
  const adapter = new WindowAdapter(sandbox);

  it('exposes window tools', () => {
    const names = adapter.getTools().map((t) => t.name);
    expect(names).toContain('os.window.list');
    expect(names).toContain('os.window.focus');
    expect(names).toContain('os.window.resize');
    expect(names).toContain('os.window.minimize');
    expect(names).toContain('os.window.restore');
  });

  it('lists windows (may be empty in CI)', async () => {
    const result: any = await adapter.getTools().find((t) => t.name === 'os.window.list')!.execute({});
    expect(Array.isArray(result)).toBe(true);
  });

  it('denies on permission failure', async () => {
    const restricted = new SecuritySandbox({ defaultPermission: 'denied' });
    const restrictedAdapter = new WindowAdapter(restricted);
    await expect(
      restrictedAdapter.getTools().find((t) => t.name === 'os.window.list')!.execute({}),
    ).rejects.toThrow('Permission denied');
  });
});
