export interface Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface IotAdapterRegistration {
  adapterId: string;
  name: string;
  version: string;
  supportedRoles: string[];
  tools: Tool[];
  mqtt: object;
  coap: object;
  modbus: object;
  sensorFusion: object;
}

import { MqttAdapter } from './mqtt-adapter';
import { CoapAdapter } from './coap-adapter';
import { ModbusAdapter } from './modbus-adapter';
import { SensorFusionAdapter } from './sensor-fusion-adapter';

export function createIotAdapterRegistration(): IotAdapterRegistration {
  const mqtt = new MqttAdapter();
  const coap = new CoapAdapter();
  const modbus = new ModbusAdapter();
  const sensorFusion = new SensorFusionAdapter();

  const tools: Tool[] = [
    ...mqtt.getTools(),
    ...coap.getTools(),
    ...modbus.getTools(),
    ...sensorFusion.getTools(),
  ];

  return {
    adapterId: 'iot',
    name: 'IoT Adapter',
    version: '0.1.0',
    supportedRoles: ['environmental_sensor', 'physical_device'],
    tools,
    mqtt,
    coap,
    modbus,
    sensorFusion,
  };
}
