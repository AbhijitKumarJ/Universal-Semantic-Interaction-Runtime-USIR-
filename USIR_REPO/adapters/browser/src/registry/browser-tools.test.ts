import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserToolRegistry } from './browser-tools';

describe('BrowserToolRegistry', () => {
  let registry: BrowserToolRegistry;

  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { href: '' },
      scrollTo: vi.fn(),
    });
    vi.stubGlobal('document', {
      querySelector: vi.fn(),
      body: { textContent: 'page content' },
    });
    vi.stubGlobal('MouseEvent', class { constructor(public type: string, public opts: any) {} } as any);
    registry = new BrowserToolRegistry();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers all 7 browser tools', () => {
    const tools = registry.list();
    expect(tools).toHaveLength(7);
  });

  it('registers browser.navigate', () => {
    expect(registry.getTool('browser.navigate')).toBeDefined();
  });

  it('registers browser.click', () => {
    expect(registry.getTool('browser.click')).toBeDefined();
  });

  it('registers browser.type', () => {
    expect(registry.getTool('browser.type')).toBeDefined();
  });

  it('registers browser.extract', () => {
    expect(registry.getTool('browser.extract')).toBeDefined();
  });

  it('registers browser.hover', () => {
    expect(registry.getTool('browser.hover')).toBeDefined();
  });

  it('registers browser.scroll', () => {
    expect(registry.getTool('browser.scroll')).toBeDefined();
  });

  it('registers browser.wait', () => {
    expect(registry.getTool('browser.wait')).toBeDefined();
  });

  it('every tool has a non-empty description', () => {
    const tools = registry.list();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('toJSON returns serializable tool list', () => {
    const json = registry.toJSON();
    expect(json).toHaveLength(7);
    for (const entry of json) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
    }
  });

  it('browser.navigate sets window.location.href', async () => {
    const tool = registry.getTool('browser.navigate')!;
    await tool.execute({ url: 'https://example.com' });
    expect(window.location.href).toBe('https://example.com');
  });

  it('browser.click throws when element not found', async () => {
    vi.mocked(document.querySelector).mockReturnValue(null);
    const tool = registry.getTool('browser.click')!;
    await expect(tool.execute({ selector: '#missing' })).rejects.toThrow('Element not found');
  });

  it('browser.click clicks the element when found', async () => {
    const mockEl = { click: vi.fn() };
    vi.mocked(document.querySelector).mockReturnValue(mockEl as any);
    const tool = registry.getTool('browser.click')!;
    const result = await tool.execute({ selector: '#btn' });
    expect(mockEl.click).toHaveBeenCalledOnce();
    expect(result).toHaveProperty('success', true);
  });

  it('browser.extract returns text content without selector', async () => {
    const tool = registry.getTool('browser.extract')!;
    const result = await tool.execute({});
    expect(result).toHaveProperty('success', true);
  });

  it('browser.extract throws when selector not found', async () => {
    vi.mocked(document.querySelector).mockReturnValue(null);
    const tool = registry.getTool('browser.extract')!;
    await expect(tool.execute({ selector: '#missing' })).rejects.toThrow('Element not found');
  });

  it('browser.hover dispatches mouse events', async () => {
    const mockEl = { dispatchEvent: vi.fn() };
    vi.mocked(document.querySelector).mockReturnValue(mockEl as any);
    const tool = registry.getTool('browser.hover')!;
    const result = await tool.execute({ selector: '#el' });
    expect(mockEl.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty('success', true);
  });

  it('browser.scroll calls window.scrollTo', async () => {
    const tool = registry.getTool('browser.scroll')!;
    await tool.execute({ x: 100, y: 200 });
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 200, left: 100, behavior: 'smooth' });
  });
});
