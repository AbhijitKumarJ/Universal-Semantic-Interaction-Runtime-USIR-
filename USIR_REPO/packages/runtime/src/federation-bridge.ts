import {
  FederatedRuntime,
  createDefaultConfig,
  type FederationRuntimeConfig,
  type FederatedRuntimeComponents,
  type FederationLifecycleEvent,
} from '@usir/federation/runtime';
import { ToolRegistry } from './disambiguation/collaborative-narrowing';
import type { AdapterCapabilityRegistry } from './disambiguation/adapter-capability-registry';

export interface FederationIntegration {
  runtime: FederatedRuntime;
  start(): Promise<void>;
  stop(): Promise<void>;
  getComponents(): FederatedRuntimeComponents;
  observe(handler: (event: FederationLifecycleEvent) => void): () => void;
}

export function createFederationIntegration(
  toolRegistry: ToolRegistry,
  capabilityRegistry: AdapterCapabilityRegistry,
  config?: Partial<FederationRuntimeConfig>,
): FederationIntegration {
  const peerId = config?.localPeerId ?? `runtime_${Date.now()}`;
  const displayName = config?.displayName ?? 'USIR Runtime';
  const fullConfig: FederationRuntimeConfig = {
    ...createDefaultConfig(peerId, displayName),
    ...config,
  };

  const federatedRuntime = new FederatedRuntime(fullConfig);

  const l8Tools = federatedRuntime.components.l8Tools.getAllTools();
  for (const tool of l8Tools) {
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      execute: tool.execute,
    });
  }

  federatedRuntime.observe((event) => {
    if (event.type === 'peer_discovered') {
      const peerEntry = federatedRuntime.components.peerDirectory.getPeer(event.peerId);
      if (peerEntry) {
        capabilityRegistry.registerAdapter({
          adapterId: `remote:${event.peerId}`,
          name: peerEntry.displayName,
          version: peerEntry.runtimeVersion,
          supportedRoles: federatedRuntime.components.peerDirectory.getCapabilities(event.peerId)?.supportedRoles ?? [],
          tools: new ToolRegistry(),
        });
      }
    }
    if (event.type === 'peer_disconnected') {
      capabilityRegistry.unregisterAdapter(`remote:${event.peerId}`);
    }
  });

  return {
    runtime: federatedRuntime,
    async start() {
      await federatedRuntime.start();
    },
    async stop() {
      await federatedRuntime.stop();
    },
    getComponents() {
      return federatedRuntime.components;
    },
    observe(handler: (event: FederationLifecycleEvent) => void) {
      return federatedRuntime.observe(handler);
    },
  };
}
