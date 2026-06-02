export interface CoapResource {
  path: string;
  title?: string;
  observable: boolean;
  contentType?: string;
  interface_?: string;
}

export interface CoapResponse {
  payload: Buffer;
  contentType?: string;
  statusCode: number;
}

export class CoapAdapter {
  private observed = new Map<string, Array<(value: Buffer) => void>>();
  private resources = new Map<string, CoapResource>();

  addLocalResource(resource: CoapResource): void {
    this.resources.set(resource.path, resource);
  }

  removeLocalResource(path: string): void {
    this.resources.delete(path);
  }

  async discover(host: string, port: number): Promise<CoapResource[]> {
    if (!host || !port) throw new Error('host and port are required');
    return Array.from(this.resources.values()).map((r) => ({ ...r }));
  }

  async get(host: string, port: number, path: string): Promise<CoapResponse> {
    if (!host || !port || !path) throw new Error('host, port, and path are required');
    const resource = this.resources.get(path);
    if (!resource) throw new Error(`Resource not found: ${path}`);
    return {
      payload: Buffer.from(JSON.stringify({ path, found: true })),
      contentType: resource.contentType ?? 'application/json',
      statusCode: 205,
    };
  }

  async put(host: string, port: number, path: string, _payload: Buffer): Promise<void> {
    if (!host || !port || !path) throw new Error('host, port, and path are required');
    const resource = this.resources.get(path);
    if (!resource) throw new Error(`Resource not found: ${path}`);
  }

  async post(host: string, port: number, path: string, _payload: Buffer): Promise<CoapResponse> {
    if (!host || !port || !path) throw new Error('host, port, and path are required');
    return {
      payload: Buffer.from(JSON.stringify({ created: true })),
      contentType: 'application/json',
      statusCode: 201,
    };
  }

  async deleteResource(host: string, port: number, path: string): Promise<void> {
    if (!host || !port || !path) throw new Error('host, port, and path are required');
    const resource = this.resources.get(path);
    if (!resource) throw new Error(`Resource not found: ${path}`);
    this.resources.delete(path);
  }

  async observe(host: string, port: number, path: string, callback: (value: Buffer) => void): Promise<() => void> {
    if (!host || !port || !path) throw new Error('host, port, and path are required');
    const key = `${host}:${port}${path}`;
    if (!this.observed.has(key)) {
      this.observed.set(key, []);
    }
    this.observed.get(key)!.push(callback);
    return () => {
      const cbs = this.observed.get(key);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
        if (cbs.length === 0) this.observed.delete(key);
      }
    };
  }

  notifyObservers(path: string, value: Buffer): void {
    for (const [key, callbacks] of this.observed.entries()) {
      if (key.endsWith(path)) {
        for (const cb of callbacks) {
          try { cb(value); } catch { /* observer error */ }
        }
      }
    }
  }

  getTools() {
    return [
      {
        name: 'iot.coap.discover',
        description: 'Discover CoAP resources on a server. Args: { host: string, port: number }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const resources = await this.discover(host, port);
          return { resources };
        },
      },
      {
        name: 'iot.coap.get',
        description: 'GET a CoAP resource. Args: { host: string, port: number, path: string }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const path = args.path as string;
          const response = await this.get(host, port, path);
          return { payload: response.payload.toString(), contentType: response.contentType, statusCode: response.statusCode };
        },
      },
      {
        name: 'iot.coap.put',
        description: 'PUT to a CoAP resource. Args: { host: string, port: number, path: string, payload: string }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const path = args.path as string;
          const payload = Buffer.from((args.payload as string) ?? '');
          await this.put(host, port, path, payload);
          return { success: true };
        },
      },
      {
        name: 'iot.coap.post',
        description: 'POST to a CoAP resource. Args: { host: string, port: number, path: string, payload?: string }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const path = args.path as string;
          const payload = Buffer.from((args.payload as string) ?? '');
          const response = await this.post(host, port, path, payload);
          return { payload: response.payload.toString(), contentType: response.contentType, statusCode: response.statusCode };
        },
      },
      {
        name: 'iot.coap.delete',
        description: 'DELETE a CoAP resource. Args: { host: string, port: number, path: string }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const path = args.path as string;
          await this.deleteResource(host, port, path);
          return { success: true };
        },
      },
      {
        name: 'iot.coap.observe',
        description: 'Observe a CoAP resource for changes. Args: { host: string, port: number, path: string }',
        execute: async (args: Record<string, unknown>) => {
          const host = args.host as string;
          const port = args.port as number;
          const path = args.path as string;
          await this.observe(host, port, path, (_value: Buffer) => {});
          return { success: true, unobserve: 'call unobserve() to stop' };
        },
      },
    ];
  }
}
