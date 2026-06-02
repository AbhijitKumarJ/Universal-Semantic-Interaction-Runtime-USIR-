import type { ProvenanceNode, ProvenanceGraph } from '@usir/protocol/provenance';

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
  trustScore?: number;
  error?: string;
}

export interface TrustPolicy {
  requireSignature: boolean;
  maxChainDepth: number;
  allowedActorTypes: Array<'user' | 'agent' | 'system'>;
  requireApprovalForDelegation: boolean;
  minimumTrustScore?: number;
}

export interface TrustScoreProvider {
  getScore(runtimeId: string): number | null;
}

export class TrustMigration {
  private policies: Map<string, TrustPolicy> = new Map();
  private pendingMigrations: Map<string, TrustMigrationRequest> = new Map();
  private trustedRuntimes: Set<string> = new Set();
  private runtimeTrustScores: Map<string, number> = new Map();
  private localGraph: ProvenanceGraph;
  private localRuntimeId: string;
  private scoreProvider: TrustScoreProvider | null = null;

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

  setTrustScore(runtimeId: string, score: number): void {
    this.runtimeTrustScores.set(runtimeId, Math.min(100, Math.max(0, score)));
  }

  getTrustScore(runtimeId: string): number | null {
    return this.runtimeTrustScores.get(runtimeId) ?? null;
  }

  setScoreProvider(provider: TrustScoreProvider): void {
    this.scoreProvider = provider;
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
    let verified = this.verifyChain(chain, policy);

    let trustScore: number | undefined;
    if (verified && policy.minimumTrustScore !== undefined) {
      const score = this.resolveTrustScore(request.sourceRuntimeId);
      trustScore = score ?? undefined;
      if (score !== null && score < policy.minimumTrustScore) {
        verified = false;
      }
    }

    if (verified && trustScore === undefined) {
      trustScore = this.resolveTrustScore(request.sourceRuntimeId) ?? undefined;
    }

    if (verified) {
      this.trustedRuntimes.add(request.sourceRuntimeId);
    }

    this.pendingMigrations.delete(request.requestId);

    return {
      success: verified,
      verified,
      chain,
      trustScore,
      error: verified ? undefined : (trustScore !== undefined && policy.minimumTrustScore !== undefined && trustScore < policy.minimumTrustScore
        ? `Trust score ${trustScore} below minimum ${policy.minimumTrustScore}`
        : 'Trust chain verification failed'),
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

  private resolveTrustScore(runtimeId: string): number | null {
    const local = this.runtimeTrustScores.get(runtimeId);
    if (local !== undefined) return local;
    if (this.scoreProvider) {
      const provided = this.scoreProvider.getScore(runtimeId);
      if (provided !== null) return provided;
    }
    return null;
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
