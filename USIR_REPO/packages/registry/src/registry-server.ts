import type { Capability, CapabilityCategory, RegistrySearchQuery, PublisherIdentity, Attestation, TrustScoreBreakdown } from '@usir/protocol/capability';
import { RegistryStore } from './registry-store';
import { fullVerification } from './verification';
import { getHealthStatus } from './health';
import { TrustEngine } from './trust-engine';
import { ReputationOracle } from './reputation-oracle';
import { UsageTracker } from './usage-tracker';
import { PricingEngine } from './pricing-engine';
import { MockPaymentProvider } from './payment-provider';
import { Invoicing } from './invoicing';
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
  public readonly usageTracker = new UsageTracker();
  public readonly pricingEngine = new PricingEngine();
  public readonly paymentProvider = new MockPaymentProvider();
  public readonly invoicing: Invoicing;
  private server: Server | null = null;
  private config: RegistryServerConfig;

  constructor(config: RegistryServerConfig) {
    this.config = config;
    this.invoicing = new Invoicing(this.pricingEngine, this.usageTracker, this.paymentProvider);
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
      } else if (path === '/usage' && method === 'POST') {
        await this.handleRecordUsage(req, res);
      } else if (path.startsWith('/usage/') && method === 'GET') {
        const capId = decodeURIComponent(path.slice('/usage/'.length));
        this.handleGetUsage(capId, url, res);
      } else if (path === '/rate-cards' && method === 'POST') {
        await this.handleSetRateCard(req, res);
      } else if (path.startsWith('/rate-cards/') && method === 'GET') {
        const capId = decodeURIComponent(path.slice('/rate-cards/'.length));
        this.handleGetRateCard(capId, res);
      } else if (path === '/invoices' && method === 'POST') {
        await this.handleGenerateInvoice(req, res);
      } else if (path === '/invoices' && method === 'GET') {
        this.handleListInvoices(url, res);
      } else if (path.startsWith('/invoices/') && method === 'GET') {
        const invId = decodeURIComponent(path.slice('/invoices/'.length));
        this.handleGetInvoice(invId, res);
      } else if (path.startsWith('/invoices/') && path.endsWith('/pay') && method === 'POST') {
        const invId = decodeURIComponent(path.slice('/invoices/'.length, -'/pay'.length));
        await this.handlePayInvoice(req, res, invId);
      } else if (path === '/checkout' && method === 'POST') {
        await this.handleCreateCheckout(req, res);
      } else if (path.startsWith('/checkout/') && method === 'GET') {
        const sessionId = decodeURIComponent(path.slice('/checkout/'.length));
        this.handleGetCheckout(sessionId, res);
      } else if (path === '/payouts' && method === 'POST') {
        await this.handleComputePayout(req, res);
      } else if (path === '/payouts' && method === 'GET') {
        this.handleListPayouts(url, res);
      } else if (path.startsWith('/payouts/') && path.endsWith('/schedule') && method === 'POST') {
        const payoutId = decodeURIComponent(path.slice('/payouts/'.length, -'/schedule'.length));
        await this.handleSchedulePayout(req, res, payoutId);
      } else if (path.startsWith('/payouts/') && path.endsWith('/process') && method === 'POST') {
        const payoutId = decodeURIComponent(path.slice('/payouts/'.length, -'/process'.length));
        await this.handleProcessPayout(req, res, payoutId);
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

  private async handleRecordUsage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: { capabilityId: string; publisherId: string; consumerId: string; quantity: number };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!parsed.capabilityId || !parsed.publisherId || !parsed.consumerId) {
      this.jsonResponse(res, 400, { error: 'Missing required fields' });
      return;
    }
    const record = this.usageTracker.recordUsage(parsed.capabilityId, parsed.publisherId, parsed.consumerId, parsed.quantity ?? 1);
    this.jsonResponse(res, 201, record);
  }

  private handleGetUsage(capabilityId: string, url: URL, res: ServerResponse): void {
    const periodStart = parseInt(url.searchParams.get('periodStart') ?? String(Date.now() - 30 * 24 * 60 * 60 * 1000), 10);
    const periodEnd = parseInt(url.searchParams.get('periodEnd') ?? String(Date.now()), 10);
    const agg = this.usageTracker.getUsage(capabilityId, periodStart, periodEnd);
    this.jsonResponse(res, 200, agg);
  }

  private async handleSetRateCard(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let card: any;
    try {
      card = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!card.capabilityId) {
      this.jsonResponse(res, 400, { error: 'Missing capabilityId' });
      return;
    }
    const listing = this.store.getListing(card.capabilityId);
    if (!listing) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }
    this.pricingEngine.setRateCard(card);
    this.jsonResponse(res, 201, { status: 'rate card set', capabilityId: card.capabilityId });
  }

  private handleGetRateCard(capabilityId: string, res: ServerResponse): void {
    const card = this.pricingEngine.getRateCard(capabilityId);
    if (!card) {
      this.jsonResponse(res, 404, { error: 'Rate card not found' });
      return;
    }
    this.jsonResponse(res, 200, card);
  }

  private async handleGenerateInvoice(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: { capabilityId: string; consumerId: string; periodStart: number; periodEnd: number };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!parsed.capabilityId || !parsed.consumerId) {
      this.jsonResponse(res, 400, { error: 'Missing required fields' });
      return;
    }
    const listing = this.store.getListing(parsed.capabilityId);
    if (!listing) {
      this.jsonResponse(res, 404, { error: 'Capability not found' });
      return;
    }
    const periodStart = parsed.periodStart ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const periodEnd = parsed.periodEnd ?? Date.now();
    const invoice = this.invoicing.generateInvoice(listing, parsed.consumerId, periodStart, periodEnd);
    this.jsonResponse(res, 201, invoice);
  }

  private handleListInvoices(url: URL, res: ServerResponse): void {
    const publisherId = url.searchParams.get('publisherId') ?? undefined;
    const consumerId = url.searchParams.get('consumerId') ?? undefined;
    const invoices = this.invoicing.listInvoices(publisherId, consumerId);
    this.jsonResponse(res, 200, invoices);
  }

  private handleGetInvoice(invoiceId: string, res: ServerResponse): void {
    const inv = this.invoicing.getInvoice(invoiceId);
    if (!inv) {
      this.jsonResponse(res, 404, { error: 'Invoice not found' });
      return;
    }
    this.jsonResponse(res, 200, inv);
  }

  private async handlePayInvoice(req: IncomingMessage, res: ServerResponse, invoiceId: string): Promise<void> {
    const body = await readBody(req);
    let parsed: { paymentMethodId: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    try {
      const { invoice, result } = await this.invoicing.processPayment(invoiceId, parsed.paymentMethodId);
      this.jsonResponse(res, 200, { invoice, paymentResult: result });
    } catch (err: any) {
      this.jsonResponse(res, 404, { error: err.message });
    }
  }

  private async handleCreateCheckout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: { invoiceId: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const session = await this.invoicing.createCheckoutSession(parsed.invoiceId);
    if (!session) {
      this.jsonResponse(res, 404, { error: 'Invoice not found' });
      return;
    }
    this.jsonResponse(res, 201, session);
  }

  private handleGetCheckout(sessionId: string, res: ServerResponse): void {
    const session = this.invoicing.getCheckoutSession(sessionId);
    if (!session) {
      this.jsonResponse(res, 404, { error: 'Checkout session not found' });
      return;
    }
    this.jsonResponse(res, 200, session);
  }

  private async handleComputePayout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: { publisherId: string; periodStart: number; periodEnd: number };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!parsed.publisherId) {
      this.jsonResponse(res, 400, { error: 'Missing publisherId' });
      return;
    }
    const payout = this.invoicing.computePayout(
      parsed.publisherId,
      parsed.periodStart ?? Date.now() - 30 * 24 * 60 * 60 * 1000,
      parsed.periodEnd ?? Date.now(),
    );
    this.jsonResponse(res, 201, payout);
  }

  private handleListPayouts(url: URL, res: ServerResponse): void {
    const publisherId = url.searchParams.get('publisherId') ?? undefined;
    const payouts = this.invoicing.listPayouts(publisherId);
    this.jsonResponse(res, 200, payouts);
  }

  private async handleSchedulePayout(_req: IncomingMessage, res: ServerResponse, payoutId: string): Promise<void> {
    const payout = this.invoicing.schedulePayout(payoutId);
    if (!payout) {
      this.jsonResponse(res, 404, { error: 'Payout not found' });
      return;
    }
    this.jsonResponse(res, 200, payout);
  }

  private async handleProcessPayout(req: IncomingMessage, res: ServerResponse, payoutId: string): Promise<void> {
    const body = await readBody(req);
    let parsed: { paymentMethodId: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const payout = await this.invoicing.processPayout(payoutId, parsed.paymentMethodId);
    if (!payout) {
      this.jsonResponse(res, 404, { error: 'Payout not found' });
      return;
    }
    this.jsonResponse(res, 200, payout);
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
