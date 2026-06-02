import type { Capability, CapabilityCategory, RegistrySearchQuery, PublisherIdentity, Attestation, TrustScoreBreakdown } from '@usir/protocol/capability';
import { RegistryStore } from './registry-store';
import { fullVerification } from './verification';
import { getHealthStatus } from './health';
import { TrustEngine } from './trust-engine';
import { ReputationOracle } from './reputation-oracle';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

export interface RegistryServerConfig {
  port: number;
  host?: string;
  requireVerification?: boolean;
}

export class RegistryServer {
  public readonly store = new RegistryStore();
  public readonly trustEngine = new TrustEngine();
  public readonly oracle = new ReputationOracle();
  private server: Server | null = null;
  private config: RegistryServerConfig;

  constructor(config: RegistryServerConfig) {
    this.config = config;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.port, this.config.host ?? '127.0.0.1', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  get port(): number {
    return this.config.port;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = req.method ?? 'GET';
      const path = url.pathname;

      if (path === '/capabilities' && method === 'POST') {
        await this.handlePublish(req, res);
      } else if (path === '/capabilities' && method === 'GET') {
        this.handleSearch(url, res);
      } else if (path.startsWith('/capabilities/') && method === 'GET') {
        const id = decodeURIComponent(path.slice('/capabilities/'.length));
        this.handleGet(id, res);
      } else if (path.startsWith('/capabilities/') && method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/capabilities/'.length));
        await this.handleUnpublish(req, res, id);
      } else if (path === '/health' && method === 'GET') {
        this.handleHealth(res);
      } else if (path === '/stats' && method === 'GET') {
        this.handleStats(res);
      } else if (path === '/publishers' && method === 'GET') {
        this.handlePublishers(res);
      } else if (path === '/trust' && method === 'GET') {
        this.handleTrustDashboard(res);
      } else if (path.startsWith('/trust/') && method === 'GET') {
        const id = decodeURIComponent(path.slice('/trust/'.length));
        this.handleTrustDetail(id, res);
      } else if (path === '/trust/attest' && method === 'POST') {
        await this.handleAttest(req, res);
      } else {
        this.jsonResponse(res, 404, { error: 'Not found' });
      }
    } catch {
      this.jsonResponse(res, 500, { error: 'Internal server error' });
    }
  }

  private async handlePublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: {
      capability: Capability;
      category: CapabilityCategory;
      publisher: PublisherIdentity;
      tags?: string[];
      signature?: string;
    };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.capability || !parsed.category || !parsed.publisher) {
      this.jsonResponse(res, 400, { error: 'Missing required fields: capability, category, publisher' });
      return;
    }

    if (this.config.requireVerification) {
      const verification = fullVerification(parsed.capability, parsed.publisher, parsed.signature);
      if (!verification.valid) {
        this.jsonResponse(res, 422, { error: `Verification failed: ${verification.reason}` });
        return;
      }
    }

    const listing = this.store.publish(
      parsed.capability,
      parsed.category,
      parsed.publisher,
      parsed.tags,
      parsed.signature,
    );

    this.jsonResponse(res, 201, listing);
  }

  private handleSearch(url: URL, res: ServerResponse): void {
    const query: RegistrySearchQuery = {};
    const q = url.searchParams.get('query');
    if (q) query.query = q;
    const cat = url.searchParams.get('category');
    if (cat) query.category = cat as CapabilityCategory;
    const tags = url.searchParams.get('tags');
    if (tags) query.tags = tags.split(',').map((t) => t.trim());
    const intentType = url.searchParams.get('intentType');
    if (intentType) query.intentType = intentType;
    const minTrust = url.searchParams.get('minTrustScore');
    if (minTrust) query.minTrustScore = parseFloat(minTrust);
    const status = url.searchParams.get('status');
    if (status) query.status = status as any;
    const offset = url.searchParams.get('offset');
    if (offset) query.offset = parseInt(offset, 10);
    const limit = url.searchParams.get('limit');
    if (limit) query.limit = parseInt(limit, 10);

    const result = this.store.search(query);
    this.jsonResponse(res, 200, result);
  }

  private handleGet(id: string, res: ServerResponse): void {
    const listing = this.store.getListing(id);
    if (!listing) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }
    this.jsonResponse(res, 200, listing);
  }

  private async handleUnpublish(_req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const success = this.store.unpublish(id);
    if (!success) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }
    this.jsonResponse(res, 200, { status: 'unpublished', capabilityId: id });
  }

  private handleHealth(res: ServerResponse): void {
    const stats = this.store.getStats();
    const health = getHealthStatus(stats, this.store['listings'].size);
    this.jsonResponse(res, health.status === 'healthy' ? 200 : 503, health);
  }

  private handleStats(res: ServerResponse): void {
    const stats = this.store.getStats();
    this.jsonResponse(res, 200, stats);
  }

  private handlePublishers(res: ServerResponse): void {
    const publishers = this.store.getPublishers();
    this.jsonResponse(res, 200, publishers);
  }

  private handleTrustDashboard(res: ServerResponse): void {
    const stats = this.store.getStats();
    const listings = Array.from((this.store as any).listings.values()).map((s: any) => s.listing).filter(Boolean);
    const breakdowns: TrustScoreBreakdown[] = listings.map((listing: any) => {
      const agg = this.oracle.getAggregate(listing.capability.capabilityId);
      return this.trustEngine.getBreakdown(listing.capability.capabilityId, listing, agg, stats.uptime);
    });
    this.jsonResponse(res, 200, { scores: breakdowns, total: breakdowns.length });
  }

  private handleTrustDetail(id: string, res: ServerResponse): void {
    const listing = this.store.getListing(id);
    if (!listing) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }
    const stats = this.store.getStats();
    const agg = this.oracle.getAggregate(id);
    const breakdown = this.trustEngine.getBreakdown(id, listing, agg, stats.uptime);
    const attestations = this.oracle.getAttestations(id);
    this.jsonResponse(res, 200, { breakdown, attestations });
  }

  private async handleAttest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let attestation: Attestation;
    try {
      attestation = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!attestation.capabilityId || !attestation.attestorId || attestation.score === undefined) {
      this.jsonResponse(res, 400, { error: 'Missing required fields: capabilityId, attestorId, score' });
      return;
    }

    const listing = this.store.getListing(attestation.capabilityId);
    if (!listing) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }

    this.oracle.submitAttestation(attestation);
    const agg = this.oracle.getAggregate(attestation.capabilityId);
    this.jsonResponse(res, 201, { status: 'recorded', aggregate: agg });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
