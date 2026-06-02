import * as Y from 'yjs';
import type { SemanticGraph, SemanticNode } from '@usir/protocol/graph';
import type { SemanticEntity, EntityRelation } from '@usir/protocol/entities';
import { createSemanticGraph } from '@usir/protocol/graph';
import type { FederatedPatch, FederatedSnapshotDiff } from '../snapshot';
import { computeDiff } from '../snapshot';

const NODES_MAP = 'nodes';
const EDGES_ARRAY = 'edges';
const META_MAP = 'meta';

interface YNodeMap extends Y.Map<unknown> {
  get(key: 'id'): string;
  get(key: 'role'): string;
  get(key: 'displayName'): string;
  get(key: 'context'): string | undefined;
  get(key: 'spatial'): string | undefined;
  get(key: 'audioFingerprint'): string | undefined;
  get(key: 'attributes'): string;
  get(key: 'relations'): string;
  get(key: 'updatedAt'): number;
  get(key: 'source'): string;
  get(key: 'outbound'): string;
  get(key: 'inbound'): string;
}

export class FederatedGraph {
  readonly doc: Y.Doc;
  readonly peerId: string;

  private nodesMap: Y.Map<Y.Map<unknown>>;
  private edgesArray: Y.Array<Y.Map<unknown>>;
  private metaMap: Y.Map<unknown>;
  private lastVersion = 0;
  private observers: Array<(event: FederatedGraphEvent) => void> = [];

  constructor(peerId: string, doc?: Y.Doc) {
    this.peerId = peerId;
    this.doc = doc ?? new Y.Doc();
    this.nodesMap = this.doc.getMap(NODES_MAP);
    this.edgesArray = this.doc.getArray(EDGES_ARRAY);
    this.metaMap = this.doc.getMap(META_MAP);

    if (!this.metaMap.has('version')) {
      this.doc.transact(() => {
        this.metaMap.set('version', 0);
        this.metaMap.set('capturedAt', Date.now());
      }, this.peerId);
    }

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.peerId) return;
      this.notifyObservers({ type: 'remote_update', update, origin: origin as string });
    });

    this.nodesMap.observe((events) => {
      for (const [key, change] of events.keys) {
        if (change.action === 'add' || change.action === 'update') {
          this.notifyObservers({ type: 'node_changed', entityId: key });
        }
        if (change.action === 'delete') {
          this.notifyObservers({ type: 'node_removed', entityId: key });
        }
      }
    });

    this.metaMap.observe(() => {
      this.notifyObservers({ type: 'meta_changed' });
    });
  }

  importGraph(graph: SemanticGraph): void {
    this.doc.transact(() => {
      for (const [id, node] of graph.nodes) {
        this.setYNode(id, node);
      }

      this.edgesArray.delete(0, this.edgesArray.length);
      for (const edge of graph.edges) {
        const yEdge = new Y.Map();
        yEdge.set('kind', edge.kind);
        yEdge.set('targetId', edge.targetId);
        if (edge.confidence !== undefined) yEdge.set('confidence', edge.confidence);
        this.edgesArray.push([yEdge]);
      }

      this.metaMap.set('version', graph.version);
      this.metaMap.set('capturedAt', graph.capturedAt);
    }, this.peerId);
    this.lastVersion = graph.version;
  }

  exportGraph(): SemanticGraph {
    const graph = createSemanticGraph();
    graph.version = (this.metaMap.get('version') as number) ?? 0;
    graph.capturedAt = (this.metaMap.get('capturedAt') as number) ?? Date.now();

    for (const [id, yNode] of this.nodesMap) {
      const yn = yNode as YNodeMap;
      const entity: SemanticEntity = {
        id: yn.get('id'),
        role: yn.get('role') as SemanticEntity['role'],
        displayName: yn.get('displayName'),
        context: this.parseOptionalJSON(yn.get('context')),
        spatial: this.parseOptionalJSON(yn.get('spatial')) as SemanticEntity['spatial'],
        audioFingerprint: this.parseOptionalJSON(yn.get('audioFingerprint')) as SemanticEntity['audioFingerprint'],
        attributes: this.parseJSON(yn.get('attributes')) as Record<string, unknown>,
        relations: this.parseJSON(yn.get('relations')) as EntityRelation[],
        updatedAt: yn.get('updatedAt'),
        source: yn.get('source'),
      };

      const outbound = this.parseJSON(yn.get('outbound')) as string[];
      const inbound = this.parseJSON(yn.get('inbound')) as string[];

      graph.nodes.set(id, { entity, outbound, inbound });

      const role = entity.role;
      if (!graph.byRole.has(role)) graph.byRole.set(role, new Set());
      graph.byRole.get(role)!.add(id);

      if (!graph.bySource.has(entity.source)) graph.bySource.set(entity.source, new Set());
      graph.bySource.get(entity.source)!.add(id);
    }

    for (const yEdge of this.edgesArray.toArray()) {
      const edge: EntityRelation = {
        kind: yEdge.get('kind') as EntityRelation['kind'],
        targetId: yEdge.get('targetId') as string,
      };
      const conf = yEdge.get('confidence');
      if (typeof conf === 'number') edge.confidence = conf;
      graph.edges.push(edge);
    }

    return graph;
  }

  addEntity(entity: SemanticEntity): void {
    this.doc.transact(() => {
      const node: SemanticNode = {
        entity,
        outbound: [],
        inbound: [],
      };
      for (const rel of entity.relations) {
        node.outbound.push(rel.targetId);
      }
      this.setYNode(entity.id, node);
      this.incrementVersion();
    }, this.peerId);
  }

  removeEntity(entityId: string): void {
    this.doc.transact(() => {
      this.nodesMap.delete(entityId);
      this.incrementVersion();
    }, this.peerId);
  }

  updateEntity(entityId: string, changes: Array<{ field: string; value: unknown }>): void {
    this.doc.transact(() => {
      const yNode = this.nodesMap.get(entityId) as YNodeMap | undefined;
      if (!yNode) return;
      for (const { field, value } of changes) {
        if (field === 'relations' || field === 'attributes' || field === 'context' || field === 'spatial' || field === 'audioFingerprint') {
          yNode.set(field, JSON.stringify(value));
        } else if (field === 'outbound' || field === 'inbound') {
          yNode.set(field, JSON.stringify(value));
        } else {
          yNode.set(field, value);
        }
      }
      this.incrementVersion();
    }, this.peerId);
  }

  hasEntity(entityId: string): boolean {
    return this.nodesMap.has(entityId);
  }

  getNodeCount(): number {
    return this.nodesMap.size;
  }

  getVersion(): number {
    return (this.metaMap.get('version') as number) ?? 0;
  }

  computeDiffFromLastKnown(): FederatedSnapshotDiff {
    const current = this.exportGraph();
    const base = createSemanticGraph();
    base.version = this.lastVersion;
    const diff = computeDiff(base, current, this.peerId);
    this.lastVersion = current.version;
    return diff;
  }

  getStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, 'remote');
  }

  getSyncMessage(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  observe(handler: (event: FederatedGraphEvent) => void): () => void {
    this.observers.push(handler);
    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  destroy(): void {
    this.doc.destroy();
    this.observers = [];
  }

  private setYNode(id: string, node: SemanticNode): void {
    let yNode = this.nodesMap.get(id) as YNodeMap | undefined;
    if (!yNode) {
      yNode = new Y.Map() as YNodeMap;
      this.nodesMap.set(id, yNode);
    }
    yNode.set('id', node.entity.id);
    yNode.set('role', node.entity.role);
    yNode.set('displayName', node.entity.displayName);
    yNode.set('context', node.entity.context ? JSON.stringify(node.entity.context) : '{}');
    yNode.set('spatial', node.entity.spatial ? JSON.stringify(node.entity.spatial) : 'null');
    yNode.set('audioFingerprint', node.entity.audioFingerprint ? JSON.stringify(node.entity.audioFingerprint) : 'null');
    yNode.set('attributes', JSON.stringify(node.entity.attributes));
    yNode.set('relations', JSON.stringify(node.entity.relations));
    yNode.set('updatedAt', node.entity.updatedAt);
    yNode.set('source', node.entity.source);
    yNode.set('outbound', JSON.stringify(node.outbound));
    yNode.set('inbound', JSON.stringify(node.inbound));
  }

  private incrementVersion(): void {
    const v = (this.metaMap.get('version') as number) ?? 0;
    this.metaMap.set('version', v + 1);
    this.metaMap.set('capturedAt', Date.now());
  }

  private notifyObservers(event: FederatedGraphEvent): void {
    for (const h of this.observers) h(event);
  }

  private parseOptionalJSON(val: string | undefined): Record<string, unknown> | undefined {
    if (!val || val === 'null') return undefined;
    try { return JSON.parse(val); } catch { return undefined; }
  }

  private parseJSON(val: string): unknown {
    try { return JSON.parse(val); } catch { return {}; }
  }
}

export type FederatedGraphEvent =
  | { type: 'remote_update'; update: Uint8Array; origin: string }
  | { type: 'node_changed'; entityId: string }
  | { type: 'node_removed'; entityId: string }
  | { type: 'meta_changed' };
