import { describe, it, expect } from 'vitest';
import { SecuritySandbox } from './sandbox';
import { SystemAdapter } from './system-adapter';

describe('SystemAdapter', () => {
  const sandbox = new SecuritySandbox({ defaultPermission: 'granted' });
  const adapter = new SystemAdapter(sandbox);

  it('exposes system tools', () => {
    const names = adapter.getTools().map((t) => t.name);
    expect(names).toContain('os.system.info');
    expect(names).toContain('os.system.env');
    expect(names).toContain('os.system.clipboard');
    expect(names).toContain('os.system.notify');
  });

  it('returns host info', async () => {
    const info: any = await adapter.getTools().find((t) => t.name === 'os.system.info')!.execute({});
    expect(info).toHaveProperty('hostname');
    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('cpus');
    expect(info.cpus).toBeGreaterThan(0);
  });

  it('reads environment variables', async () => {
    const result: any = await adapter.getTools().find((t) => t.name === 'os.system.env')!.execute({ key: 'HOME' });
    expect(result.key).toBe('HOME');
    expect(result.value).toBeDefined();
  });
});
