import type { ToolRegistry, Tool } from './collaborative-narrowing';

export interface AdapterRegistration {
  adapterId: string;
  name: string;
  version: string;
  supportedRoles: string[];
  tools: ToolRegistry;
}

/**
 * Cross-adapter capability registry.
 *
 * Aggregates tools from all registered adapters so the runtime can
 * discover which adapter can handle a given tool call or entity role.
 * This is the bridge between adapter-specific ToolRegistries and the
 * runtime's intent execution pipeline.
 */
export class AdapterCapabilityRegistry {
  private adapters = new Map<string, AdapterRegistration>();
  private toolToAdapter = new Map<string, string>();
  private roleToAdapters = new Map<string, string[]>();

  public registerAdapter(registration: AdapterRegistration): void {
    this.adapters.set(registration.adapterId, registration);
    for (const tool of registration.tools.list()) {
      this.toolToAdapter.set(tool.name, registration.adapterId);
    }
    for (const role of registration.supportedRoles) {
      const existing = this.roleToAdapters.get(role) ?? [];
      existing.push(registration.adapterId);
      this.roleToAdapters.set(role, existing);
    }
  }

  public unregisterAdapter(adapterId: string): void {
    const reg = this.adapters.get(adapterId);
    if (!reg) return;
    for (const tool of reg.tools.list()) {
      this.toolToAdapter.delete(tool.name);
    }
    for (const [, adapters] of this.roleToAdapters) {
      const idx = adapters.indexOf(adapterId);
      if (idx >= 0) adapters.splice(idx, 1);
    }
    this.adapters.delete(adapterId);
  }

  public findTool(toolName: string): { adapterId: string; tool: Tool } | null {
    const adapterId = this.toolToAdapter.get(toolName);
    if (!adapterId) return null;
    const reg = this.adapters.get(adapterId);
    if (!reg) return null;
    const tool = reg.tools.getTool(toolName);
    if (!tool) return null;
    return { adapterId, tool };
  }

  public getAdaptersForRole(role: string): AdapterRegistration[] {
    const ids = this.roleToAdapters.get(role) ?? [];
    return ids.map((id) => this.adapters.get(id)!).filter(Boolean);
  }

  public listAllAdapters(): AdapterRegistration[] {
    return Array.from(this.adapters.values());
  }

  public listAllTools(): Array<{ adapterId: string; tool: Tool }> {
    const result: Array<{ adapterId: string; tool: Tool }> = [];
    for (const [adapterId, reg] of this.adapters) {
      for (const tool of reg.tools.list()) {
        result.push({ adapterId, tool });
      }
    }
    result.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
    return result;
  }

  public hasAdapter(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }
}
