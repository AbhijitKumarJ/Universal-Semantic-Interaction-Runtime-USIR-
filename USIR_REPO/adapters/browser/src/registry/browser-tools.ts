import { ToolRegistry } from './tool-registry';

export class BrowserToolRegistry extends ToolRegistry {
  constructor() {
    super();
    this.registerBrowserTools();
  }

  private registerBrowserTools(): void {
    this.register({
      name: 'browser.navigate',
      description: 'Navigate the current tab to a URL. Args: { url: string }',
      execute: async (args) => {
        const { url } = args as { url: string };
        window.location.href = url;
        return { success: true, affectedEntityIds: [`url://${url}`], provenanceId: `prov-nav-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.click',
      description: 'Click an element on the page. Args: { selector: string }',
      execute: async (args) => {
        const { selector } = args as { selector: string };
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        (el as HTMLElement).click();
        return { success: true, affectedEntityIds: [selector], provenanceId: `prov-click-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.type',
      description: 'Type text into an input element. Args: { selector: string, text: string, clear?: boolean }',
      execute: async (args) => {
        const { selector, text, clear } = args as { selector: string; text: string; clear?: boolean };
        const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) throw new Error(`Input not found: ${selector}`);
        if (clear) el.value = '';
        el.value += text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, affectedEntityIds: [selector], provenanceId: `prov-type-${Date.now()}`, metadata: { charCount: text.length } };
      },
    });

    this.register({
      name: 'browser.extract',
      description: 'Extract text content from an element. Args: { selector?: string, attribute?: string }',
      execute: async (args) => {
        const { selector, attribute } = args as { selector?: string; attribute?: string };
        if (selector) {
          const el = document.querySelector(selector);
          if (!el) throw new Error(`Element not found: ${selector}`);
          const content = attribute ? el.getAttribute(attribute) : el.textContent;
          return { success: true, affectedEntityIds: [selector], provenanceId: `prov-extract-${Date.now()}`, metadata: { content, length: content?.length ?? 0 } };
        }
        return { success: true, affectedEntityIds: [], provenanceId: `prov-extract-${Date.now()}`, metadata: { content: document.body?.textContent ?? '', length: document.body?.textContent?.length ?? 0 } };
      },
    });

    this.register({
      name: 'browser.hover',
      description: 'Hover over an element. Args: { selector: string }',
      execute: async (args) => {
        const { selector } = args as { selector: string };
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return { success: true, affectedEntityIds: [selector], provenanceId: `prov-hover-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.scroll',
      description: 'Scroll the page. Args: { x?: number, y?: number, behavior?: "smooth" | "instant" }',
      execute: async (args) => {
        const { x = 0, y = 0, behavior = 'smooth' } = args as { x?: number; y?: number; behavior?: ScrollBehavior };
        window.scrollTo({ top: y, left: x, behavior });
        return { success: true, affectedEntityIds: [], provenanceId: `prov-scroll-${Date.now()}`, metadata: { x, y } };
      },
    });

    this.register({
      name: 'browser.wait',
      description: 'Wait for a condition or a timeout. Args: { ms: number } or { selector: string, timeoutMs?: number }',
      execute: async (args) => {
        const { ms, selector, timeoutMs = 5000 } = args as { ms?: number; selector?: string; timeoutMs?: number };
        if (ms) {
          await new Promise((r) => setTimeout(r, ms));
          return { success: true, affectedEntityIds: [], provenanceId: `prov-wait-${Date.now()}`, metadata: { waitedMs: ms } };
        }
        if (selector) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            if (document.querySelector(selector)) {
              return { success: true, affectedEntityIds: [selector], provenanceId: `prov-wait-${Date.now()}`, metadata: { foundAfterMs: Date.now() - start } };
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error(`Timeout waiting for selector: ${selector}`);
        }
        return { success: true, affectedEntityIds: [], provenanceId: `prov-wait-${Date.now()}` };
      },
    });
  }
}
