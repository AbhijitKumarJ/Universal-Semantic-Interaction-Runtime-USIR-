import { describe, it, expect } from 'vitest';
import { AdapterCapabilityRegistry } from './adapter-capability-registry';
import { ToolRegistry } from './collaborative-narrowing';

describe('AdapterCapabilityRegistry (runtime)', () => {
  it('registers and finds tools', () => {
    const reg = new AdapterCapabilityRegistry();
    const tools = new ToolRegistry();
    tools.register({ name: 'test.tool', description: 'desc', execute: async () => 'ok' });
    reg.registerAdapter({ adapterId: 'a1', name: 'Test', version: '0.1.0', supportedRoles: ['ui_region'], tools });
    expect(reg.findTool('test.tool')).not.toBeNull();
    expect(reg.findTool('test.tool')!.adapterId).toBe('a1');
  });

  it('returns null for unknown tool', () => {
    const reg = new AdapterCapabilityRegistry();
    expect(reg.findTool('missing')).toBeNull();
  });

  it('lists all tools across adapters', () => {
    const reg = new AdapterCapabilityRegistry();
    const t1 = new ToolRegistry(); t1.register({ name: 'a.tool', description: '', execute: async () => {} });
    const t2 = new ToolRegistry(); t2.register({ name: 'b.tool', description: '', execute: async () => {} });
    reg.registerAdapter({ adapterId: 'a', name: 'A', version: '1', supportedRoles: [], tools: t1 });
    reg.registerAdapter({ adapterId: 'b', name: 'B', version: '1', supportedRoles: [], tools: t2 });
    expect(reg.listAllTools()).toHaveLength(2);
  });

  it('finds adapters by role', () => {
    const reg = new AdapterCapabilityRegistry();
    const tools = new ToolRegistry();
    reg.registerAdapter({ adapterId: 'r1', name: 'R1', version: '1', supportedRoles: ['form_field', 'panel'], tools });
    expect(reg.getAdaptersForRole('form_field')).toHaveLength(1);
    expect(reg.getAdaptersForRole('unknown')).toHaveLength(0);
  });

  it('unregisters adapter cleanly', () => {
    const reg = new AdapterCapabilityRegistry();
    const tools = new ToolRegistry();
    tools.register({ name: 'gone', description: '', execute: async () => {} });
    reg.registerAdapter({ adapterId: 'g', name: 'G', version: '1', supportedRoles: ['x'], tools });
    expect(reg.hasAdapter('g')).toBe(true);
    reg.unregisterAdapter('g');
    expect(reg.hasAdapter('g')).toBe(false);
    expect(reg.findTool('gone')).toBeNull();
  });
});
