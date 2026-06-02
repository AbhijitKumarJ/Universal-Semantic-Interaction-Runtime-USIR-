import { describe, it, expect } from 'vitest';
import { verifyCapabilitySchema, verifyPublisherIdentity, fullVerification } from './verification';
import type { Capability, PublisherIdentity } from '@usir/protocol/capability';

function validCapability(overrides?: Partial<Capability>): Capability {
  return {
    capabilityId: 'cap://test/valid/v1',
    displayName: 'Valid Cap',
    handlesIntents: ['intent.test'],
    intentLayers: ['L1'],
    provider: { id: 'prov-1', name: 'Provider', trustScore: 0.8 },
    pricing: { model: 'free' },
    requiredPermissions: ['read'],
    endpoint: { protocol: 'in-process' },
    metadata: { version: '1.0.0', description: 'A valid capability' },
    ...overrides,
  };
}

function validPublisher(): PublisherIdentity {
  return { publisherId: 'pub-1', name: 'Publisher', publicKey: 'key-abc' };
}

describe('verifyCapabilitySchema', () => {
  it('passes a valid capability', () => {
    const result = verifyCapabilitySchema(validCapability());
    expect(result.valid).toBe(true);
  });

  it('fails when capabilityId is missing', () => {
    const result = verifyCapabilitySchema(validCapability({ capabilityId: '' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('capabilityId');
  });

  it('fails when displayName is missing', () => {
    const result = verifyCapabilitySchema(validCapability({ displayName: '' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('displayName');
  });

  it('fails when provider.id is missing', () => {
    const result = verifyCapabilitySchema(validCapability({ provider: { id: '', name: '', trustScore: 0 } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('provider.id');
  });

  it('fails when no intents are handled', () => {
    const result = verifyCapabilitySchema(validCapability({ handlesIntents: [] }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('intent');
  });

  it('fails when version is missing', () => {
    const result = verifyCapabilitySchema(validCapability({ metadata: { version: '', description: '' } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('version');
  });
});

describe('verifyPublisherIdentity', () => {
  it('passes a valid publisher', () => {
    expect(verifyPublisherIdentity(validPublisher()).valid).toBe(true);
  });

  it('fails when publisherId is missing', () => {
    expect(verifyPublisherIdentity({ publisherId: '', name: 'N', publicKey: 'k' }).valid).toBe(false);
  });

  it('fails when name is missing', () => {
    expect(verifyPublisherIdentity({ publisherId: 'p1', name: '', publicKey: 'k' }).valid).toBe(false);
  });

  it('fails when publicKey is missing', () => {
    expect(verifyPublisherIdentity({ publisherId: 'p1', name: 'N', publicKey: '' }).valid).toBe(false);
  });

  it('fails when publisherId is too short', () => {
    expect(verifyPublisherIdentity({ publisherId: 'ab', name: 'N', publicKey: 'k' }).valid).toBe(false);
  });
});

describe('fullVerification', () => {
  it('passes valid capability with valid publisher', () => {
    const result = fullVerification(validCapability(), validPublisher());
    expect(result.valid).toBe(true);
  });

  it('fails on schema error', () => {
    const result = fullVerification(validCapability({ capabilityId: '' }), validPublisher());
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('capabilityId');
  });

  it('fails on publisher error', () => {
    const result = fullVerification(validCapability(), { publisherId: '', name: '', publicKey: '' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('publisher');
  });
});
