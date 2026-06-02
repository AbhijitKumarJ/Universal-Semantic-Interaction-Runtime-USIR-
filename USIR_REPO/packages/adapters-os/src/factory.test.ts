import { describe, it, expect } from 'vitest';
import { createOsAdapterRegistration } from './factory';

describe('createOsAdapterRegistration', () => {
  it('creates registration with all tools', () => {
    const reg = createOsAdapterRegistration({ defaultPermission: 'granted' });
    expect(reg.adapterId).toBe('os');
    expect(reg.name).toBe('OS Adapter');
    expect(reg.version).toBe('0.1.0');
    expect(reg.supportedRoles).toEqual(['system', 'utility']);
    expect(reg.sandbox).toBeDefined();
    expect(reg.tools.length).toBeGreaterThan(0);
  });

  it('includes tools from all 5 adapters', () => {
    const reg = createOsAdapterRegistration({ defaultPermission: 'granted' });
    const names = reg.tools.map((t) => t.name);
    expect(names).toContain('os.process.list');
    expect(names).toContain('os.fs.read');
    expect(names).toContain('os.window.list');
    expect(names).toContain('os.system.info');
    expect(names).toContain('os.shell.exec');
  });

  it('every tool has name, description, and execute function', () => {
    const reg = createOsAdapterRegistration({ defaultPermission: 'granted' });
    for (const tool of reg.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});
