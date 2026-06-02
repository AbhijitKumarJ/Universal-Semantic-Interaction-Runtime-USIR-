import type { Capability, PublisherIdentity } from '@usir/protocol/capability';
import { createHash, verify } from 'crypto';

export type VerificationResult = {
  valid: boolean;
  reason?: string;
};

export function verifyCapabilitySignature(
  capability: Capability,
  publisher: PublisherIdentity,
  signature: string,
): VerificationResult {
  if (!publisher.publicKey) {
    return { valid: false, reason: 'Publisher has no public key' };
  }

  const payload = serializeForSigning(capability);
  const expectedHash = createHash('sha256').update(payload).digest('hex');

  try {
    const verifier = createHash('sha256');
    verifier.update(expectedHash + publisher.publicKey);
    const computed = verifier.digest('hex');

    const isValid = computed === signature;
    return {
      valid: isValid,
      reason: isValid ? undefined : 'Signature mismatch',
    };
  } catch {
    return { valid: false, reason: 'Verification failed' };
  }
}

export function verifyPublisherIdentity(publisher: PublisherIdentity): VerificationResult {
  if (!publisher.publisherId) {
    return { valid: false, reason: 'Missing publisher ID' };
  }
  if (!publisher.name) {
    return { valid: false, reason: 'Missing publisher name' };
  }
  if (!publisher.publicKey) {
    return { valid: false, reason: 'Missing public key' };
  }
  if (publisher.publisherId.length < 3) {
    return { valid: false, reason: 'Publisher ID too short (min 3 chars)' };
  }
  return { valid: true };
}

export function verifyCapabilitySchema(capability: Capability): VerificationResult {
  if (!capability.capabilityId || capability.capabilityId.trim() === '') {
    return { valid: false, reason: 'Missing capabilityId' };
  }
  if (!capability.displayName || capability.displayName.trim() === '') {
    return { valid: false, reason: 'Missing displayName' };
  }
  if (!capability.provider?.id || capability.provider.id.trim() === '') {
    return { valid: false, reason: 'Missing provider.id' };
  }
  if (!capability.handlesIntents || capability.handlesIntents.length === 0) {
    return { valid: false, reason: 'Must handle at least one intent type' };
  }
  if (!capability.metadata?.version || capability.metadata.version.trim() === '') {
    return { valid: false, reason: 'Missing metadata.version' };
  }
  return { valid: true };
}

export function fullVerification(
  capability: Capability,
  publisher: PublisherIdentity,
  signature?: string,
): VerificationResult {
  const schemaCheck = verifyCapabilitySchema(capability);
  if (!schemaCheck.valid) return schemaCheck;

  const publisherCheck = verifyPublisherIdentity(publisher);
  if (!publisherCheck.valid) return publisherCheck;

  if (signature) {
    return verifyCapabilitySignature(capability, publisher, signature);
  }

  return { valid: true };
}

function serializeForSigning(capability: Capability): string {
  return JSON.stringify({
    id: capability.capabilityId,
    name: capability.displayName,
    provider: capability.provider.id,
    version: capability.metadata.version,
    intents: capability.handlesIntents.sort(),
  });
}
