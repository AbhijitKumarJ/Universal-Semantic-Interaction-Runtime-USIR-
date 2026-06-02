import type { TrustPolicy } from '../provenance-bridge';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface FederationRuntimeConfig {
  localPeerId: string;
  displayName: string;
  runtimeVersion?: string;

  stunServers?: string[];
  turnServers?: IceServerConfig[];

  maxPeers: number;
  syncThrottleMs: number;
  heartbeatIntervalMs: number;
  maxReconnectAttempts: number;

  supportedRoles: string[];
  supportedLayers: number[];
  supportedIntents: string[];

  trustPolicies: Array<{
    runtimeId: string;
    policy: TrustPolicy;
  }>;

  trustedRuntimes: string[];
}

export function createDefaultConfig(peerId: string, displayName: string): FederationRuntimeConfig {
  return {
    localPeerId: peerId,
    displayName,
    runtimeVersion: '0.1.0',
    stunServers: ['stun:stun.l.google.com:19302'],
    turnServers: [],
    maxPeers: 10,
    syncThrottleMs: 100,
    heartbeatIntervalMs: 5000,
    maxReconnectAttempts: 5,
    supportedRoles: [],
    supportedLayers: [],
    supportedIntents: [],
    trustPolicies: [],
    trustedRuntimes: [],
  };
}
