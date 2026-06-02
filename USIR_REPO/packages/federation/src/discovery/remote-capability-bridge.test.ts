import { describe, it, expect } from 'vitest';
import { createRemoteCapabilityBridge } from './remote-capability-bridge';

describe('RemoteCapabilityBridge', () => {
  const bridge = createRemoteCapabilityBridge();

  it('registers remote adapters', () => {
    bridge.registerRemoteAdapter({
      peerId: 'peer-a',
      adapterId: 'adapter-1',
      name: 'Test Adapter',
      version: '1.0.0',
      supportedRoles: ['function', 'class'],
      tools: [{ name: 'test.tool', description: 'A test tool', adapterId: 'adapter-1' }],
    });

    expect(bridge.listAllRemoteAdapters()).toHaveLength(1);
    expect(bridge.listAllRemoteTools()).toHaveLength(1);
  });

  it('finds remote tools by name', () => {
    const found = bridge.findRemoteTool('test.tool');
    expect(found).not.toBeNull();
    expect(found!.peerId).toBe('peer-a');
  });

  it('filters adapters by role', () => {
    const forRole = bridge.getRemoteAdaptersForRole('function');
    expect(forRole).toHaveLength(1);
  });

  it('unregisters peer and removes all its tools', () => {
    bridge.unregisterPeer('peer-a');
    expect(bridge.listAllRemoteAdapters()).toHaveLength(0);
    expect(bridge.findRemoteTool('test.tool')).toBeNull();
  });
});
