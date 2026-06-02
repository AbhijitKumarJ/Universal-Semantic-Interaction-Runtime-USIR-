import { describe, it, expect } from 'vitest';
import { MqttAdapter } from './mqtt-adapter';

describe('MqttAdapter', () => {
  it('connects and disconnects', async () => {
    const adapter = new MqttAdapter();
    expect(adapter.connected_).toBe(false);
    await adapter.connect('mqtt://broker.local:1883');
    expect(adapter.connected_).toBe(true);
    await adapter.disconnect();
    expect(adapter.connected_).toBe(false);
  });

  it('throws on double connect', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker.local:1883');
    await expect(adapter.connect('mqtt://other:1883')).rejects.toThrow('Already connected');
  });

  it('throws connecting when not connected', async () => {
    const adapter = new MqttAdapter();
    await expect(adapter.publish('test/topic', 'hello')).rejects.toThrow('Not connected');
    await expect(adapter.subscribe('test/topic')).rejects.toThrow('Not connected');
  });

  it('publishes and stores messages', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    await adapter.publish('test/topic', 'hello', { qos: 1, retain: true });
    await adapter.publish('test/topic', 'world', { qos: 2 });
    const msgs = adapter.listMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].payload).toBe('hello');
    expect(msgs[0].qos).toBe(1);
    expect(msgs[0].retain).toBe(true);
    expect(msgs[1].payload).toBe('world');
  });

  it('filters messages by topic', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    await adapter.publish('sensor/temp', '22');
    await adapter.publish('sensor/humidity', '60');
    const tempMsgs = adapter.listMessages('sensor/temp');
    expect(tempMsgs).toHaveLength(1);
    expect(tempMsgs[0].payload).toBe('22');
  });

  it('notifies subscribed callbacks', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    const received: string[] = [];
    await adapter.subscribe('test/topic', (msg) => received.push(msg.payload));
    await adapter.publish('test/topic', 'notified');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('notified');
  });

  it('handles unsubscribe', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    const received: string[] = [];
    await adapter.subscribe('test/topic', (msg) => received.push(msg.payload));
    await adapter.unsubscribe('test/topic');
    await adapter.publish('test/topic', 'after-unsub');
    expect(received).toHaveLength(0);
  });

  it('manages topic bridges', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    adapter.addBridge({ topic: 'sensor/#', entityId: 'entity-1', direction: 'to-entity' });
    adapter.addBridge({ topic: 'actuator/1', entityId: 'entity-2', direction: 'bidirectional' });
    expect(adapter.listBridges()).toHaveLength(2);
    adapter.removeBridge('actuator/1', 'entity-2');
    expect(adapter.listBridges()).toHaveLength(1);
  });

  it('supports wildcard topic matching', async () => {
    const adapter = new MqttAdapter();
    await adapter.connect('mqtt://broker:1883');
    const matched: string[] = [];
    await adapter.subscribe('sensor/+/temp', (msg) => matched.push(msg.payload));
    await adapter.publish('sensor/room1/temp', '22');
    await adapter.publish('sensor/room2/temp', '24');
    await adapter.publish('sensor/room1/humidity', '60');
    expect(matched).toHaveLength(2);
  });
});
