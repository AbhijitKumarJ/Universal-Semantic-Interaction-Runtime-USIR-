export interface Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface XrAdapterRegistration {
  adapterId: string;
  name: string;
  version: string;
  supportedRoles: string[];
  tools: Tool[];
  unityBridge: object;
  spatialAnchor: object;
  xrInput: object;
}

import { UnityBridgeAdapter } from './unity-bridge-adapter';
import { SpatialAnchorAdapter } from './spatial-anchor-adapter';
import { XrInputAdapter } from './xr-input-adapter';

export function createXrAdapterRegistration(): XrAdapterRegistration {
  const unityBridge = new UnityBridgeAdapter();
  const spatialAnchor = new SpatialAnchorAdapter();
  const xrInput = new XrInputAdapter();

  const tools: Tool[] = [
    ...unityBridge.getTools(),
    ...spatialAnchor.getTools(),
    ...xrInput.getTools(),
  ];

  return {
    adapterId: 'xr',
    name: 'XR Adapter',
    version: '0.1.0',
    supportedRoles: ['spatial_anchor'],
    tools,
    unityBridge,
    spatialAnchor,
    xrInput,
  };
}
