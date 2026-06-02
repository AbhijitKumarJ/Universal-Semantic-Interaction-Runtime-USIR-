import { describe, it, expect } from 'vitest';
import { ModbusAdapter } from './modbus-adapter';

describe('ModbusAdapter', () => {
  it('connects and disconnects', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: '192.168.1.100', port: 502 });
    expect(adapter.connected_).toBe(true);
    await adapter.disconnect();
    expect(adapter.connected_).toBe(false);
  });

  it('throws on double connect', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    await expect(adapter.connect({ host: 'other', port: 502 })).rejects.toThrow('Already connected');
  });

  it('reads and writes coils', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    const before = await adapter.readCoils(0, 3);
    expect(before).toEqual([false, false, false]);
    await adapter.writeCoil(0, true);
    await adapter.writeCoil(2, true);
    const after = await adapter.readCoils(0, 3);
    expect(after).toEqual([true, false, true]);
  });

  it('reads and writes holding registers', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    const before = await adapter.readHoldingRegisters(100, 2);
    expect(before).toEqual([0, 0]);
    await adapter.writeRegister(100, 42);
    await adapter.writeRegister(101, 255);
    const after = await adapter.readHoldingRegisters(100, 2);
    expect(after).toEqual([42, 255]);
  });

  it('validates register value range', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    await expect(adapter.writeRegister(0, 70000)).rejects.toThrow('0-65535');
  });

  it('browses OPC-UA tags', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    const tags = await adapter.browseOpcuaTags('opc.tcp://localhost:4840');
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags[0].nodeId).toBe('ns=0;i=85');
  });

  it('reads OPC-UA tag values', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    const value = await adapter.readOpcuaTag('ns=0;i=2256');
    expect(typeof value).toBe('string');
  });

  it('throws for unknown OPC-UA tag', async () => {
    const adapter = new ModbusAdapter();
    await adapter.connect({ host: 'localhost', port: 502 });
    await expect(adapter.readOpcuaTag('ns=999;i=999')).rejects.toThrow('not found');
  });
});
