import { describe, it, expect } from 'vitest';
import { AdapterCapabilityRegistry, ToolRegistry, type Tool } from '@usir/runtime';

describe('AdapterCapabilityRegistry', () => {
  it('registers and finds tools', () => {
    const reg = new AdapterCapabilityRegistry();
    const tools = new ToolRegistry();
    tools.register({ name: 'test.tool', description: 'A test tool', execute: async () => 'ok' });
    reg.registerAdapter({
      adapterId: 'test-adapter',
      name: 'Test',
      version: '0.1.0',
      supportedRoles: ['ui_region', 'document'],
      tools,
    });

    const found = reg.findTool('test.tool');
    expect(found).not.toBeNull();
    expect(found!.adapterId).toBe('test-adapter');
    expect(found!.tool.name).toBe('test.tool');
  });

  it('returns null for unknown tool', () => {
    const reg = new AdapterCapabilityRegistry();
    expect(reg.findTool('nonexistent')).toBeNull();
  });

  it('lists all tools across adapters', () => {
    const reg = new AdapterCapabilityRegistry();
    const t1 = new ToolRegistry();
    t1.register({ name: 'a.tool', description: '', execute: async () => {} });
    const t2 = new ToolRegistry();
    t2.register({ name: 'b.tool', description: '', execute: async () => {} });
    reg.registerAdapter({ adapterId: 'adapter-a', name: 'A', version: '1', supportedRoles: [], tools: t1 });
    reg.registerAdapter({ adapterId: 'adapter-b', name: 'B', version: '1', supportedRoles: [], tools: t2 });

    const all = reg.listAllTools();
    expect(all).toHaveLength(2);
  });

  it('finds adapters by supported role', () => {
    const reg = new AdapterCapabilityRegistry();
    const t1 = new ToolRegistry();
    reg.registerAdapter({ adapterId: 'role-adapter', name: 'Role', version: '1', supportedRoles: ['form_field', 'panel'], tools: t1 });

    const adapters = reg.getAdaptersForRole('form_field');
    expect(adapters).toHaveLength(1);
    expect(adapters[0].adapterId).toBe('role-adapter');
  });

  it('unregisters adapter and removes its tools', () => {
    const reg = new AdapterCapabilityRegistry();
    const tools = new ToolRegistry();
    tools.register({ name: 'gone.tool', description: '', execute: async () => {} });
    reg.registerAdapter({ adapterId: 'gone', name: 'Gone', version: '1', supportedRoles: ['ui_region'], tools });

    expect(reg.findTool('gone.tool')).not.toBeNull();
    reg.unregisterAdapter('gone');
    expect(reg.findTool('gone.tool')).toBeNull();
    expect(reg.hasAdapter('gone')).toBe(false);
  });
});
