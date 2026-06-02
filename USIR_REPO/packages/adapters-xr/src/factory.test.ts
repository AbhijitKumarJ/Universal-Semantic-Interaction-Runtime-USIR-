import { describe, it, expect } from 'vitest';
import { createXrAdapterRegistration } from './factory';

describe('createXrAdapterRegistration', () => {
  it('creates a valid XR adapter registration', () => {
    const reg = createXrAdapterRegistration();
    expect(reg.adapterId).toBe('xr');
    expect(reg.version).toBe('0.1.0');
    expect(reg.supportedRoles).toContain('spatial_anchor');
  });

  it('includes tools from all XR sub-adapters', () => {
    const reg = createXrAdapterRegistration();
    const names = reg.tools.map((t) => t.name);
    expect(names).toContain('xr.unity.connect');
    expect(names).toContain('xr.anchor.create');
    expect(names).toContain('xr.input.handTracking');
  });

  it('exposes internal adapter instances', () => {
    const reg = createXrAdapterRegistration();
    expect(reg.unityBridge).toBeDefined();
    expect(reg.spatialAnchor).toBeDefined();
    expect(reg.xrInput).toBeDefined();
  });

  it('all tools have execute functions', () => {
    const reg = createXrAdapterRegistration();
    for (const tool of reg.tools) {
      expect(typeof tool.execute).toBe('function');
      expect(typeof tool.name).toBe('string');
    }
  });
});
