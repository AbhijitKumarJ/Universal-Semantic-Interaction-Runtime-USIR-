import { describe, it, expect } from 'vitest';
import { CoapAdapter } from './coap-adapter';

describe('CoapAdapter', () => {
  it('discovers local resources', async () => {
    const adapter = new CoapAdapter();
    adapter.addLocalResource({ path: '/temperature', observable: true, contentType: 'application/json' });
    adapter.addLocalResource({ path: '/humidity', observable: false });
    const resources = await adapter.discover('localhost', 5683);
    expect(resources).toHaveLength(2);
    expect(resources.find((r) => r.path === '/temperature')?.observable).toBe(true);
  });

  it('handles GET on existing resource', async () => {
    const adapter = new CoapAdapter();
    adapter.addLocalResource({ path: '/status', observable: false });
    const response = await adapter.get('localhost', 5683, '/status');
    expect(response.statusCode).toBe(205);
    expect(response.contentType).toBe('application/json');
  });

  it('throws on GET for missing resource', async () => {
    const adapter = new CoapAdapter();
    await expect(adapter.get('localhost', 5683, '/missing')).rejects.toThrow('Resource not found');
  });

  it('handles PUT and POST requests', async () => {
    const adapter = new CoapAdapter();
    adapter.addLocalResource({ path: '/config', observable: false });
    await expect(adapter.put('localhost', 5683, '/config', Buffer.from('data'))).resolves.toBeUndefined();
    const postResp = await adapter.post('localhost', 5683, '/config', Buffer.from('update'));
    expect(postResp.statusCode).toBe(201);
  });

  it('handles DELETE', async () => {
    const adapter = new CoapAdapter();
    adapter.addLocalResource({ path: '/temp', observable: false });
    await adapter.deleteResource('localhost', 5683, '/temp');
    await expect(adapter.get('localhost', 5683, '/temp')).rejects.toThrow('Resource not found');
  });

  it('supports observe/unobserve', async () => {
    const adapter = new CoapAdapter();
    adapter.addLocalResource({ path: '/sensor/temp', observable: true });
    const observed: Buffer[] = [];
    const unobserve = await adapter.observe('localhost', 5683, '/sensor/temp', (val) => observed.push(val));
    adapter.notifyObservers('/sensor/temp', Buffer.from('22'));
    adapter.notifyObservers('/sensor/temp', Buffer.from('23'));
    expect(observed).toHaveLength(2);
    unobserve();
    adapter.notifyObservers('/sensor/temp', Buffer.from('24'));
    expect(observed).toHaveLength(2);
  });
});
