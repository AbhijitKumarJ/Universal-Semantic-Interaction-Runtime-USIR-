import type {
  Capability,
  CapabilityCategory,
  CapabilityListing,
  RegistrySearchQuery,
  RegistrySearchResult,
  PublisherIdentity,
  RegistryStats,
} from '@usir/protocol/capability';
import { request as httpRequest } from 'http';

export interface RegistryClientConfig {
  baseUrl: string;
  timeout?: number;
}

export class RegistryClient {
  private config: RegistryClientConfig;

  constructor(config: RegistryClientConfig) {
    this.config = config;
  }

  async publish(
    capability: Capability,
    category: CapabilityCategory,
    publisher: PublisherIdentity,
    tags?: string[],
    signature?: string,
  ): Promise<CapabilityListing> {
    return this.request<CapabilityListing>('POST', '/capabilities', {
      capability,
      category,
      publisher,
      tags,
      signature,
    });
  }

  async get(capabilityId: string): Promise<CapabilityListing | null> {
    try {
      return await this.request<CapabilityListing>('GET', `/capabilities/${encodeURIComponent(capabilityId)}`);
    } catch {
      return null;
    }
  }

  async search(query: RegistrySearchQuery): Promise<RegistrySearchResult> {
    const params = new URLSearchParams();
    if (query.query) params.set('query', query.query);
    if (query.category) params.set('category', query.category);
    if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
    if (query.intentType) params.set('intentType', query.intentType);
    if (query.minTrustScore !== undefined) params.set('minTrustScore', String(query.minTrustScore));
    if (query.status) params.set('status', query.status);
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    if (query.limit !== undefined) params.set('limit', String(query.limit));

    const qs = params.toString();
    return this.request<RegistrySearchResult>('GET', `/capabilities${qs ? '?' + qs : ''}`);
  }

  async unpublish(capabilityId: string): Promise<boolean> {
    try {
      await this.request<{ status: string }>('DELETE', `/capabilities/${encodeURIComponent(capabilityId)}`);
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<{ status: string; uptime: number }> {
    return this.request('GET', '/health');
  }

  async stats(): Promise<RegistryStats> {
    return this.request<RegistryStats>('GET', '/stats');
  }

  async publishers(): Promise<PublisherIdentity[]> {
    return this.request<PublisherIdentity[]>('GET', '/publishers');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.config.baseUrl);
      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        timeout: this.config.timeout ?? 10000,
        headers: {} as Record<string, string>,
      };

      if (body) {
        options.headers['Content-Type'] = 'application/json';
      }

      const req = httpRequest(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(new Error(`Invalid JSON response: ${raw.slice(0, 100)}`));
            }
          } else {
            try {
              const errBody = JSON.parse(raw);
              reject(new Error(errBody.error ?? `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 100)}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}
