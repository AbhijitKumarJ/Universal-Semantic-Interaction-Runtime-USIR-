export interface ModbusDeviceConfig {
  host: string;
  port: number;
  unitId?: number;
}

export interface ModbusRegister {
  address: number;
  value: number;
  type: 'coil' | 'discrete_input' | 'holding_register' | 'input_register';
}

export interface OpcuaTag {
  nodeId: string;
  browseName: string;
  dataType: string;
  description?: string;
}

export class ModbusAdapter {
  private connected = false;
  private config: ModbusDeviceConfig | null = null;
  private coils = new Map<number, boolean>();
  private holdingRegisters = new Map<number, number>();
  private opcuaTags: OpcuaTag[] = [
    { nodeId: 'ns=0;i=85', browseName: 'Server', dataType: 'Object' },
    { nodeId: 'ns=0;i=2256', browseName: 'CurrentTime', dataType: 'DateTime' },
  ];

  get connected_(): boolean { return this.connected; }

  async connect(config: ModbusDeviceConfig): Promise<void> {
    if (this.connected) throw new Error('Already connected to Modbus device');
    if (!config.host || !config.port) throw new Error('host and port are required');
    this.config = config;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Modbus device');
    this.connected = false;
    this.config = null;
  }

  async readCoils(address: number, count: number): Promise<boolean[]> {
    if (!this.connected) throw new Error('Not connected to Modbus device');
    const result: boolean[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.coils.get(address + i) ?? false);
    }
    return result;
  }

  async writeCoil(address: number, value: boolean): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Modbus device');
    this.coils.set(address, value);
  }

  async readHoldingRegisters(address: number, count: number): Promise<number[]> {
    if (!this.connected) throw new Error('Not connected to Modbus device');
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.holdingRegisters.get(address + i) ?? 0);
    }
    return result;
  }

  async writeRegister(address: number, value: number): Promise<void> {
    if (!this.connected) throw new Error('Not connected to Modbus device');
    if (value < 0 || value > 65535) throw new Error('Register value must be 0-65535');
    this.holdingRegisters.set(address, value);
  }

  async browseOpcuaTags(_endpointUrl: string): Promise<OpcuaTag[]> {
    return [...this.opcuaTags];
  }

  async readOpcuaTag(nodeId: string): Promise<unknown> {
    const tag = this.opcuaTags.find((t) => t.nodeId === nodeId);
    if (!tag) throw new Error(`OPC-UA tag not found: ${nodeId}`);
    if (tag.nodeId === 'ns=0;i=2256') return new Date().toISOString();
    return { nodeId: tag.nodeId, browseName: tag.browseName, dataType: tag.dataType };
  }

  getTools() {
    return [
      {
        name: 'iot.modbus.connect',
        description: 'Connect to a Modbus device. Args: { host: string, port: number, unitId?: number }',
        execute: async (args: Record<string, unknown>) => {
          await this.connect(args as unknown as ModbusDeviceConfig);
          return { success: true, host: this.config?.host, port: this.config?.port };
        },
      },
      {
        name: 'iot.modbus.disconnect',
        description: 'Disconnect from the Modbus device.',
        execute: async () => {
          await this.disconnect();
          return { success: true };
        },
      },
      {
        name: 'iot.modbus.readCoils',
        description: 'Read coil values from Modbus device. Args: { address: number, count: number }',
        execute: async (args: Record<string, unknown>) => {
          const address = args.address as number;
          const count = args.count as number;
          const values = await this.readCoils(address, count);
          return { address, values };
        },
      },
      {
        name: 'iot.modbus.writeCoil',
        description: 'Write a coil value on Modbus device. Args: { address: number, value: boolean }',
        execute: async (args: Record<string, unknown>) => {
          const address = args.address as number;
          const value = args.value as boolean;
          await this.writeCoil(address, value);
          return { success: true, address, value };
        },
      },
      {
        name: 'iot.modbus.readRegisters',
        description: 'Read holding registers from Modbus device. Args: { address: number, count: number }',
        execute: async (args: Record<string, unknown>) => {
          const address = args.address as number;
          const count = args.count as number;
          const values = await this.readHoldingRegisters(address, count);
          return { address, values };
        },
      },
      {
        name: 'iot.modbus.writeRegister',
        description: 'Write a holding register on Modbus device. Args: { address: number, value: number }',
        execute: async (args: Record<string, unknown>) => {
          const address = args.address as number;
          const value = args.value as number;
          await this.writeRegister(address, value);
          return { success: true, address, value };
        },
      },
      {
        name: 'iot.modbus.browseOpcua',
        description: 'Browse OPC-UA server tags. Args: { endpointUrl: string }',
        execute: async (args: Record<string, unknown>) => {
          const endpointUrl = args.endpointUrl as string;
          const tags = await this.browseOpcuaTags(endpointUrl);
          return { tags };
        },
      },
      {
        name: 'iot.modbus.readOpcuaTag',
        description: 'Read an OPC-UA tag value. Args: { nodeId: string }',
        execute: async (args: Record<string, unknown>) => {
          const nodeId = args.nodeId as string;
          const value = await this.readOpcuaTag(nodeId);
          return { nodeId, value };
        },
      },
    ];
  }
}
