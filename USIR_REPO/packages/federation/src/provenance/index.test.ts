import { describe, it, expect } from 'vitest';
import { createAnchor, createProvenanceBridgeState } from './index';

describe('ProvenanceAnchor', () => {
  it('creates an anchor with the correct fields', () => {
    const anchor = createAnchor({
      anchorType: 'import',
      localRuntimeId: 'runtime-a',
      localProvenanceId: 'prov-1',
      remoteRuntimeId: 'runtime-b',
      remoteProvenanceId: 'prov-remote-1',
    });

    expect(anchor.anchorType).toBe('import');
    expect(anchor.localRuntimeId).toBe('runtime-a');
    expect(anchor.remoteRuntimeId).toBe('runtime-b');
    expect(anchor.remoteProvenanceId).toBe('prov-remote-1');
    expect(anchor.linkedAt).toBeGreaterThan(0);
    expect(anchor.trustChain).toEqual([]);
  });

  it('creates an export anchor', () => {
    const anchor = createAnchor({
      anchorType: 'export',
      localRuntimeId: 'runtime-a',
      localProvenanceId: 'prov-2',
      remoteRuntimeId: 'runtime-c',
      remoteProvenanceId: 'prov-remote-2',
    });
    expect(anchor.anchorType).toBe('export');
  });

  it('creates a mirror anchor', () => {
    const anchor = createAnchor({
      anchorType: 'mirror',
      localRuntimeId: 'runtime-a',
      localProvenanceId: 'prov-3',
      remoteRuntimeId: 'runtime-d',
      remoteProvenanceId: 'prov-remote-3',
    });
    expect(anchor.anchorType).toBe('mirror');
  });
});

describe('ProvenanceBridgeState', () => {
  it('creates a bridge state with empty collections', () => {
    const state = createProvenanceBridgeState('runtime-a');
    expect(state.runtimeId).toBe('runtime-a');
    expect(state.anchors.size).toBe(0);
    expect(state.pendingExports).toEqual([]);
    expect(state.pendingImports).toEqual([]);
    expect(state.lastSyncAt).toBe(0);
  });
});
