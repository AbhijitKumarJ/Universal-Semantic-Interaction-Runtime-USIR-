import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';
import { ProcessAdapter } from './process-adapter';

describe('ProcessAdapter', () => {
  const sandbox = new SecuritySandbox({ defaultPermission: 'granted' });
  const adapter = new ProcessAdapter(sandbox);

  it('exposes tools with correct names', () => {
    const tools = adapter.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('os.process.list');
    expect(names).toContain('os.process.spawn');
    expect(names).toContain('os.process.signal');
    expect(names).toContain('os.process.kill');
    expect(names).toContain('os.process.monitor');
  });

  it('lists processes', async () => {
    const result = await adapter.getTools().find((t) => t.name === 'os.process.list')!.execute({});
    expect(Array.isArray(result)).toBe(true);
  });

  it('denies on permission failure', async () => {
    const restricted = new SecuritySandbox({ defaultPermission: 'denied' });
    const restrictedAdapter = new ProcessAdapter(restricted);
    await expect(
      restrictedAdapter.getTools().find((t) => t.name === 'os.process.list')!.execute({}),
    ).rejects.toThrow('Permission denied');
  });
});
