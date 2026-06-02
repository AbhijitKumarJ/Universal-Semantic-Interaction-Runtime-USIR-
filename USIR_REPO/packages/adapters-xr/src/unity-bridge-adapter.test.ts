import { describe, it, expect } from 'vitest';
import { UnityBridgeAdapter } from './unity-bridge-adapter';

describe('UnityBridgeAdapter', () => {
  it('connects and disconnects', async () => {
    const adapter = new UnityBridgeAdapter();
    await adapter.connect('ws://localhost:8080', 'websocket');
    expect(adapter.connected_).toBe(true);
    await adapter.disconnect();
    expect(adapter.connected_).toBe(false);
  });

  it('throws on double connect', async () => {
    const adapter = new UnityBridgeAdapter();
    await adapter.connect('ws://localhost:8080');
    await expect(adapter.connect('ws://other:8080')).rejects.toThrow('Already connected');
  });

  it('throws when not connected', async () => {
    const adapter = new UnityBridgeAdapter();
    await expect(adapter.sendTransform({} as never)).rejects.toThrow('Not connected');
    await expect(adapter.receiveTransforms()).rejects.toThrow('Not connected');
    await expect(adapter.triggerEvent({} as never)).rejects.toThrow('Not connected');
    await expect(adapter.pollEvents()).rejects.toThrow('Not connected');
  });

  it('sends and receives spatial transforms', async () => {
    const adapter = new UnityBridgeAdapter();
    await adapter.connect('ws://unity:8080');
    await adapter.sendTransform({
      entityId: 'cube-1',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      timestamp: 1000,
    });
    const received = await adapter.receiveTransforms();
    expect(received).toHaveLength(1);
    expect(received[0].entityId).toBe('cube-1');
    expect(received[0].position.x).toBe(1);
  });

  it('triggers and polls events', async () => {
    const adapter = new UnityBridgeAdapter();
    await adapter.connect('ws://unity:8080');
    await adapter.triggerEvent({ type: 'select', source: 'hand', data: { entityId: 'obj-1' }, timestamp: Date.now() });
    await adapter.triggerEvent({ type: 'hover', source: 'eye', data: {}, timestamp: Date.now() });
    const events = await adapter.pollEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('select');
    expect(events[0].source).toBe('hand');
    expect(events[1].type).toBe('hover');
    const afterPoll = await adapter.pollEvents();
    expect(afterPoll).toHaveLength(0);
  });
});
