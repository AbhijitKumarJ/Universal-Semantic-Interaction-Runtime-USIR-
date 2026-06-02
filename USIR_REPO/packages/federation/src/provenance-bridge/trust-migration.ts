import type { ProvenanceNode, Authorization, ProvenanceGraph } from '@usir/protocol/provenance';

export interface TrustMigrationRequest {
  requestId: string;
  sourceRuntimeId: string;
  targetRuntimeId: string;
  provenanceId: string;
  requestedAt: number;
  expiresAt: number;
}

export interface TrustMigrationResult {
  success: boolean;
  verified: boolean;
  chain: string[];
  error?: string;
}

export interface TrustPolicy {
  requireSignature: boolean;
  maxChainDepth: number;
  allowedActorTypes: Array<'user' | 'agent' | 'system'>;
  requireApprovalForDelegation: boolean;
}

export class TrustMigration {
  private policies: Map<string, TrustPolicy> = new Map();
  private pendingMigrations: Map<string, TrustMigrationRequest> = new Map();
  private trustedRuntimes: Set<string> = new Set();
  private localGraph: ProvenanceGraph;
  private localRuntimeId: string;

  constructor(localRuntimeId: string, localGraph: ProvenanceGraph) {
    this.localRuntimeId = localRuntimeId;
    this.localGraph = localGraph;
  }

  setTrustPolicy(runtimeId: string, policy: TrustPolicy): void {
    this.policies.set(runtimeId, policy);
  }

  addTrustedRuntime(runtimeId: string): void {
    this.trustedRuntimes.add(runtimeId);
  }

  removeTrustedRuntime(runtimeId: string): void {
    this.trustedRuntimes.delete(runtimeId);
  }

  isRuntimeTrusted(runtimeId: string): boolean {
    return this.trustedRuntimes.has(runtimeId);
  }

  requestMigration(request: TrustMigrationRequest): TrustMigrationResult {
    if (Date.now() > request.expiresAt) {
      return { success: false, verified: false, chain: [], error: 'Migration request expired' };
    }

    this.pendingMigrations.set(request.requestId, request);

    const policy = this.policies.get(request.sourceRuntimeId) ?? this.getDefaultPolicy();
    const node = this.localGraph.nodes.get(request.provenanceId);
    if (!node) {
      return { success: false, verified: false, chain: [], error: `Provenance node ${request.provenanceId} not found` };
    }

    const chain = this.buildChain(node, policy);
    const verified = this.verifyChain(chain, policy);

    if (verified) {
      this.trustedRuntimes.add(request.sourceRuntimeId);
    }

    this.pendingMigrations.delete(request.requestId);

    return {
      success: verified,
      verified,
      chain,
      error: verified ? undefined : 'Trust chain verification failed',
    };
  }

  approveNode(provenanceId: string, approverId: string, approvalIntentId: string): ProvenanceNode | undefined {
    const node = this.localGraph.nodes.get(provenanceId);
    if (!node) return undefined;

    const updatedNode: ProvenanceNode = {
      ...node,
      authorization: {
        type: 'approved',
        approvalIntentId,
        approverId,
        at: Date.now(),
      },
    };

    this.localGraph.nodes.set(provenanceId, updatedNode);
    return updatedNode;
  }

  chainApproval(
    localProvenanceId: string,
    remoteRuntimeId: string,
    remoteProvenanceId: string,
  ): ProvenanceNode | undefined {
    const localNode = this.localGraph.nodes.get(localProvenanceId);
    if (!localNode) return undefined;

    if (!this.isRuntimeTrusted(remoteRuntimeId)) {
      return undefined;
    }

    const chainedNode: ProvenanceNode = {
      ...localNode,
      remoteProvenanceId,
      remoteRuntimeId,
      authorization: {
        type: 'approved',
        approvalIntentId: `chain_${localProvenanceId}_${remoteProvenanceId}`,
        approverId: `runtime:${remoteRuntimeId}`,
        at: Date.now(),
      },
    };

    this.localGraph.nodes.set(localProvenanceId, chainedNode);
    return chainedNode;
  }

  private buildChain(node: ProvenanceNode, policy: TrustPolicy): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [node.provenanceId];

    while (queue.length > 0 && chain.length < policy.maxChainDepth) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const n = this.localGraph.nodes.get(id);
      if (!n) continue;

      const actorType = n.actor.type;
      if (policy.allowedActorTypes.includes(actorType)) {
        chain.push(id);
      }

      for (const parentId of n.causalParents) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }

    return chain;
  }

  private verifyChain(chain: string[], policy: TrustPolicy): boolean {
    if (chain.length === 0) return false;

    for (const nodeId of chain) {
      const node = this.localGraph.nodes.get(nodeId);
      if (!node) return false;

      if (!policy.allowedActorTypes.includes(node.actor.type)) {
        return false;
      }

      if (policy.requireSignature && !node.signature) {
        return false;
      }

      if (policy.requireApprovalForDelegation) {
        if (node.actor.type === 'agent' && node.authorization.type !== 'approved') {
          return false;
        }
      }
    }

    return true;
  }

  private getDefaultPolicy(): TrustPolicy {
    return {
      requireSignature: false,
      maxChainDepth: 50,
      allowedActorTypes: ['user', 'agent', 'system'],
      requireApprovalForDelegation: false,
    };
  }
}
