import type { CapabilityPayload } from '../message';

export interface RegistryQueryClient {
  search(query: { query?: string; status?: string }): Promise<{
    items: Array<{
      capability: {
        capabilityId: string;
        displayName: string;
        handlesIntents: string[];
        provider: { id: string; name: string; trustScore: number };
        metadata: { version: string; description?: string };
      };
    }>;
    total: number;
  }>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  adapterId: string;
}

export interface RemoteAdapterRegistration {
  peerId: string;
  adapterId: string;
  name: string;
  version: string;
  supportedRoles: string[];
  tools: ToolDescriptor[];
}

export interface RemoteCapabilityBridge {
  registerRemoteAdapter(registration: RemoteAdapterRegistration): void;
  unregisterRemoteAdapter(peerId: string, adapterId: string): void;
  unregisterPeer(peerId: string): void;
  findRemoteTool(toolName: string): { peerId: string; tool: ToolDescriptor } | null;
  getRemoteAdaptersForRole(role: string): RemoteAdapterRegistration[];
  listAllRemoteTools(): Array<{ peerId: string; tool: ToolDescriptor }>;
  listAllRemoteAdapters(): RemoteAdapterRegistration[];
  setRegistryClient(client: RegistryQueryClient): void;
  queryRegistry(query: string): Promise<{
    items: Array<{ capability: { capabilityId: string; displayName: string; handlesIntents: string[]; provider: { id: string; name: string; trustScore: number }; metadata: { version: string; description?: string } } }>;
    total: number;
  }>;
}

export function createRemoteCapabilityBridge(): RemoteCapabilityBridge {
  const adapters: Map<string, RemoteAdapterRegistration> = new Map();
  const toolIndex: Map<string, { peerId: string; tool: ToolDescriptor }> = new Map();
  const roleIndex: Map<string, string[]> = new Map();
  let registryClient: RegistryQueryClient | null = null;

  function addToRoleIndex(role: string, adapterKey: string): void {
    if (!roleIndex.has(role)) roleIndex.set(role, []);
    roleIndex.get(role)!.push(adapterKey);
  }

  return {
    registerRemoteAdapter(registration: RemoteAdapterRegistration): void {
      const key = `${registration.peerId}:${registration.adapterId}`;
      adapters.set(key, registration);

      for (const tool of registration.tools) {
        toolIndex.set(tool.name, { peerId: registration.peerId, tool });
      }
      for (const role of registration.supportedRoles) {
        addToRoleIndex(role, key);
      }
    },

    unregisterRemoteAdapter(peerId: string, adapterId: string): void {
      const key = `${peerId}:${adapterId}`;
      const reg = adapters.get(key);
      if (reg) {
        for (const tool of reg.tools) {
          toolIndex.delete(tool.name);
        }
        adapters.delete(key);
      }
    },

    unregisterPeer(peerId: string): void {
      const toRemove: string[] = [];
      for (const [key, reg] of adapters) {
        if (reg.peerId === peerId) {
          toRemove.push(key);
          for (const tool of reg.tools) {
            toolIndex.delete(tool.name);
          }
        }
      }
      for (const key of toRemove) adapters.delete(key);
      for (const [role, keys] of roleIndex) {
        roleIndex.set(role, keys.filter((k) => !toRemove.includes(k)));
      }
    },

    findRemoteTool(toolName: string): { peerId: string; tool: ToolDescriptor } | null {
      return toolIndex.get(toolName) ?? null;
    },

    getRemoteAdaptersForRole(role: string): RemoteAdapterRegistration[] {
      const keys = roleIndex.get(role) ?? [];
      return keys.map((k) => adapters.get(k)!).filter(Boolean);
    },

    listAllRemoteTools(): Array<{ peerId: string; tool: ToolDescriptor }> {
      return Array.from(toolIndex.values());
    },

    listAllRemoteAdapters(): RemoteAdapterRegistration[] {
      return Array.from(adapters.values());
    },

    setRegistryClient(client: RegistryQueryClient): void {
      registryClient = client;
    },

    async queryRegistry(query: string) {
      if (!registryClient) {
        return { items: [], total: 0 };
      }
      return registryClient.search({ query, status: 'active' });
    },
  };
}
