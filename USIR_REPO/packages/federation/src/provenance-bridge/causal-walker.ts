import type { ProvenanceNode, ProvenanceGraph } from '@usir/protocol/provenance';
import type { ProvenanceAnchor } from '../provenance';

export interface CrossRuntimeCausalNode {
  node: ProvenanceNode;
  runtimeId: string;
  isLocal: boolean;
}

export interface CrossRuntimeCausalChain {
  nodes: CrossRuntimeCausalNode[];
  totalHops: number;
  spansRuntimes: boolean;
  runtimesInvolved: string[];
}

export class CrossRuntimeCausalWalker {
  private localGraph: ProvenanceGraph;
  private anchors: Map<string, ProvenanceAnchor>;

  constructor(localGraph: ProvenanceGraph, anchors: Map<string, ProvenanceAnchor>) {
    this.localGraph = localGraph;
    this.anchors = anchors;
  }

  walk(provenanceId: string, maxDepth: number = 100): CrossRuntimeCausalChain {
    const visited = new Set<string>();
    const chain: CrossRuntimeCausalNode[] = [];
    const runtimesInvolved = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: provenanceId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth) break;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.findNode(id);
      if (!node) continue;

      const isLocal = !id.startsWith('remote:');
      const runtimeId = node.runtimeId ?? (isLocal ? 'local' : 'remote');

      chain.push({ node, runtimeId, isLocal });
      runtimesInvolved.add(runtimeId);

      for (const parentId of node.causalParents) {
        if (!visited.has(parentId)) {
          queue.push({ id: parentId, depth: depth + 1 });
        }
      }

      const anchor = this.findAnchorForProvenance(id);
      if (anchor) {
        const remoteId = `remote:${anchor.remoteProvenanceId}`;
        if (!visited.has(remoteId)) {
          queue.push({ id: remoteId, depth: depth + 1 });
        }
      }
    }

    return {
      nodes: chain.reverse(),
      totalHops: chain.length,
      spansRuntimes: runtimesInvolved.size > 1,
      runtimesInvolved: Array.from(runtimesInvolved),
    };
  }

  walkEntityHistory(entityId: string, maxDepth: number = 50): CrossRuntimeCausalChain {
    const entityNodes = this.localGraph.byEntity.get(entityId) ?? [];
    const chain: CrossRuntimeCausalNode[] = [];
    const runtimesInvolved = new Set<string>();

    for (const nodeId of entityNodes) {
      const node = this.localGraph.nodes.get(nodeId);
      if (!node) continue;
      const isLocal = !nodeId.startsWith('remote:');
      const runtimeId = node.runtimeId ?? (isLocal ? 'local' : 'remote');
      chain.push({ node, runtimeId, isLocal });
      runtimesInvolved.add(runtimeId);

      for (const anchor of this.anchors.values()) {
        if (anchor.localProvenanceId === node.provenanceId && anchor.anchorType === 'import') {
          const remoteNode = this.findNode(`remote:${anchor.remoteProvenanceId}`);
          if (remoteNode) {
            chain.push({ node: remoteNode, runtimeId: anchor.remoteRuntimeId, isLocal: false });
            runtimesInvolved.add(anchor.remoteRuntimeId);
          }
        }
      }

      if (chain.length >= maxDepth) break;
    }

    return {
      nodes: chain,
      totalHops: chain.length,
      spansRuntimes: runtimesInvolved.size > 1,
      runtimesInvolved: Array.from(runtimesInvolved),
    };
  }

  private findNode(id: string): ProvenanceNode | undefined {
    const localId = id.startsWith('remote:') ? id.slice(7) : id;
    return this.localGraph.nodes.get(id) ?? this.localGraph.nodes.get(localId);
  }

  private findAnchorForProvenance(provenanceId: string): ProvenanceAnchor | undefined {
    for (const anchor of this.anchors.values()) {
      if (anchor.localProvenanceId === provenanceId || anchor.remoteProvenanceId === provenanceId) {
        return anchor;
      }
    }
    return undefined;
  }
}
