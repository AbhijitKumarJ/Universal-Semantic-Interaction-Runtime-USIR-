import { describe, it, expect } from 'vitest';
import { createIotAdapterRegistration } from './factory';

describe('createIotAdapterRegistration', () => {
  it('creates a valid IoT adapter registration', () => {
    const reg = createIotAdapterRegistration();
    expect(reg.adapterId).toBe('iot');
    expect(reg.version).toBe('0.1.0');
    expect(reg.supportedRoles).toContain('environmental_sensor');
    expect(reg.supportedRoles).toContain('physical_device');
    expect(reg.tools.length).toBeGreaterThan(0);
  });

  it('includes tools from all IoT sub-adapters', () => {
    const reg = createIotAdapterRegistration();
    const names = reg.tools.map((t) => t.name);
    expect(names).toContain('iot.mqtt.connect');
    expect(names).toContain('iot.coap.discover');
    expect(names).toContain('iot.modbus.connect');
    expect(names).toContain('iot.sensor.ingest');
  });

  it('exposes internal adapter instances', () => {
    const reg = createIotAdapterRegistration();
    expect(reg.mqtt).toBeDefined();
    expect(reg.coap).toBeDefined();
    expect(reg.modbus).toBeDefined();
    expect(reg.sensorFusion).toBeDefined();
  });

  it('all tools have execute functions', () => {
    const reg = createIotAdapterRegistration();
    for (const tool of reg.tools) {
      expect(typeof tool.execute).toBe('function');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
    }
  });
});
