import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RegistryServer } from './registry-server';
import { request as httpRequest } from 'http';

const PORT = 18923;

function httpGet(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    httpRequest(
      { hostname: '127.0.0.1', port: PORT, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, body: safeParse(raw) });
        });
      },
    ).on('error', reject).end();
  });
}

function httpPost(path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, body: safeParse(raw) });
        });
      },
    ).on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpDelete(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    httpRequest(
      { hostname: '127.0.0.1', port: PORT, path, method: 'DELETE' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, body: safeParse(raw) });
        });
      },
    ).on('error', reject).end();
  });
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

describe('RegistryServer HTTP', () => {
  let server: RegistryServer;

  beforeAll(async () => {
    server = new RegistryServer({ port: PORT, requireVerification: false });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /health returns healthy status', async () => {
    const res = await httpGet('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.version).toBe('0.1.0');
  });

  it('GET /stats returns stats', async () => {
    const res = await httpGet('/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalCapabilities).toBe('number');
  });

  it('POST /capabilities publishes a capability', async () => {
    const res = await httpPost('/capabilities', {
      capability: {
        capabilityId: 'cap://http/test/v1',
        displayName: 'HTTP Test',
        handlesIntents: ['intent.test'],
        intentLayers: ['L1'],
        provider: { id: 'prov-http', name: 'HTTP Provider', trustScore: 0.9 },
        pricing: { model: 'free' },
        requiredPermissions: ['read'],
        endpoint: { protocol: 'in-process' },
        metadata: { version: '1.0.0', description: 'Test via HTTP' },
      },
      category: 'development',
      publisher: { publisherId: 'pub-http', name: 'HTTP Pub', publicKey: 'key-http' },
      tags: ['http-test'],
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.capability.capabilityId).toBe('cap://http/test/v1');
  });

  it('GET /capabilities/:id retrieves a capability', async () => {
    const res = await httpGet('/capabilities/cap%3A%2F%2Fhttp%2Ftest%2Fv1');
    expect(res.status).toBe(200);
    expect(res.body.capability.displayName).toBe('HTTP Test');
  });

  it('GET /capabilities/:id returns 404 for missing', async () => {
    const res = await httpGet('/capabilities/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /capabilities searches by query', async () => {
    const res = await httpGet('/capabilities?query=HTTP');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('GET /capabilities filters by category', async () => {
    const res = await httpGet('/capabilities?category=development');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /publishers returns publisher list', async () => {
    const res = await httpGet('/publishers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /capabilities/:id unpublishes', async () => {
    const res = await httpDelete('/capabilities/cap%3A%2F%2Fhttp%2Ftest%2Fv1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unpublished');
  });

  it('DELETE /capabilities/:id returns 404 for missing', async () => {
    const res = await httpDelete('/capabilities/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /capabilities validates required fields', async () => {
    const res = await httpPost('/capabilities', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing required');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await httpGet('/unknown');
    expect(res.status).toBe(404);
  });

  it('GET /trust/:id returns trust breakdown for a capability', async () => {
    await httpPost('/capabilities', {
      capability: {
        capabilityId: 'cap://trust/detail/v1',
        displayName: 'Trust Detail',
        handlesIntents: ['intent.test'],
        intentLayers: ['L1'],
        provider: { id: 'prov-tr', name: 'Trust Prov', trustScore: 0.9 },
        pricing: { model: 'free' },
        requiredPermissions: ['read'],
        endpoint: { protocol: 'in-process' },
        metadata: { version: '1.0.0' },
      },
      category: 'development',
      publisher: { publisherId: 'pub-tr', name: 'Trust Pub', publicKey: 'key-tr' },
    });

    const res = await httpGet('/trust/cap%3A%2F%2Ftrust%2Fdetail%2Fv1');
    expect(res.status).toBe(200);
    expect(res.body.breakdown).toBeDefined();
    expect(res.body.breakdown.capabilityId).toBe('cap://trust/detail/v1');
    expect(res.body.breakdown.overall).toBeGreaterThan(0);
    expect(res.body.attestations).toBeDefined();
  });

  it('POST /trust/attest records an attestation', async () => {
    await httpPost('/capabilities', {
      capability: {
        capabilityId: 'cap://trust/attest/v1',
        displayName: 'Attest Target',
        handlesIntents: ['intent.test'],
        intentLayers: ['L1'],
        provider: { id: 'prov-at', name: 'AT Prov', trustScore: 0.7 },
        pricing: { model: 'free' },
        requiredPermissions: ['read'],
        endpoint: { protocol: 'in-process' },
        metadata: { version: '1.0.0' },
      },
      category: 'development',
      publisher: { publisherId: 'pub-at', name: 'AT Pub', publicKey: 'key-at' },
    });

    const res = await httpPost('/trust/attest', {
      id: 'att-test-1',
      capabilityId: 'cap://trust/attest/v1',
      attestorId: 'peer-test',
      score: 92,
      attestedAt: Date.now(),
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('recorded');
    expect(res.body.aggregate.averageScore).toBe(92);
  });

  it('GET /trust returns trust dashboard', async () => {
    const res = await httpGet('/trust');
    expect(res.status).toBe(200);
    expect(res.body.scores).toBeDefined();
    expect(res.body.total).toBeGreaterThan(0);
  });
});
