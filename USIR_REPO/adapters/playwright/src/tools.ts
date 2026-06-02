import { ToolRegistry } from '@usir/runtime';
import type { Page } from 'playwright';

export class PlaywrightToolRegistry extends ToolRegistry {
  private page: Page;

  constructor(page: Page) {
    super();
    this.page = page;
    this.registerPlaywrightTools();
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  private registerPlaywrightTools(): void {
    this.register({
      name: 'browser.navigate',
      description: 'Navigate to a URL. Args: { url: string }',
      execute: async (args) => {
        const { url } = args as { url: string };
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        return { success: true, affectedEntityIds: [`url://${url}`], provenanceId: `pw-nav-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.click',
      description: 'Click an element by selector. Args: { selector: string }',
      execute: async (args) => {
        const { selector } = args as { selector: string };
        await this.page.click(selector);
        return { success: true, affectedEntityIds: [selector], provenanceId: `pw-click-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.type',
      description: 'Type text into an input. Args: { selector: string, text: string, clear?: boolean }',
      execute: async (args) => {
        const { selector, text, clear } = args as { selector: string; text: string; clear?: boolean };
        if (clear) await this.page.fill(selector, '');
        await this.page.fill(selector, text);
        return { success: true, affectedEntityIds: [selector], provenanceId: `pw-type-${Date.now()}`, metadata: { charCount: text.length } };
      },
    });

    this.register({
      name: 'browser.extract',
      description: 'Extract text from an element or the full page. Args: { selector?: string, attribute?: string }',
      execute: async (args) => {
        const { selector, attribute } = args as { selector?: string; attribute?: string };
        if (selector) {
          const content = await this.page.evaluate(({ sel, attr }: { sel: string; attr?: string }) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            return attr ? el.getAttribute(attr) : el.textContent;
          }, { sel: selector, attr: attribute });
          return { success: true, affectedEntityIds: [selector], provenanceId: `pw-extract-${Date.now()}`, metadata: { content, length: content?.length ?? 0 } };
        }
        const text = await this.page.evaluate(() => document.body?.textContent ?? '');
        return { success: true, affectedEntityIds: [], provenanceId: `pw-extract-${Date.now()}`, metadata: { content: text, length: text.length } };
      },
    });

    this.register({
      name: 'browser.screenshot',
      description: 'Take a screenshot of the page or an element. Args: { selector?: string, fullPage?: boolean }',
      execute: async (args) => {
        const { selector, fullPage } = args as { selector?: string; fullPage?: boolean };
        if (selector) {
          const el = await this.page.$(selector);
          if (!el) throw new Error(`Element not found: ${selector}`);
          const buffer = await el.screenshot();
          return { success: true, affectedEntityIds: [selector], provenanceId: `pw-shot-${Date.now()}`, metadata: { size: buffer.length, mimeType: 'image/png' } };
        }
        const buffer = await this.page.screenshot({ fullPage: fullPage ?? false });
        return { success: true, affectedEntityIds: [], provenanceId: `pw-shot-${Date.now()}`, metadata: { size: buffer.length, mimeType: 'image/png' } };
      },
    });

    this.register({
      name: 'browser.hover',
      description: 'Hover over an element. Args: { selector: string }',
      execute: async (args) => {
        const { selector } = args as { selector: string };
        await this.page.hover(selector);
        return { success: true, affectedEntityIds: [selector], provenanceId: `pw-hover-${Date.now()}` };
      },
    });

    this.register({
      name: 'browser.scroll',
      description: 'Scroll the page. Args: { x?: number, y?: number }',
      execute: async (args) => {
        const { x = 0, y = 0 } = args as { x?: number; y?: number };
        await this.page.evaluate(({ px, py }: { px: number; py: number }) => window.scrollTo(px, py), { px: x, py: y });
        return { success: true, affectedEntityIds: [], provenanceId: `pw-scroll-${Date.now()}`, metadata: { x, y } };
      },
    });

    this.register({
      name: 'browser.wait',
      description: 'Wait for a condition. Args: { ms: number } or { selector: string, timeoutMs?: number }',
      execute: async (args) => {
        const { ms, selector, timeoutMs = 5000 } = args as { ms?: number; selector?: string; timeoutMs?: number };
        if (ms) {
          await this.page.waitForTimeout(ms);
          return { success: true, affectedEntityIds: [], provenanceId: `pw-wait-${Date.now()}`, metadata: { waitedMs: ms } };
        }
        if (selector) {
          await this.page.waitForSelector(selector, { timeout: timeoutMs });
          return { success: true, affectedEntityIds: [selector], provenanceId: `pw-wait-${Date.now()}`, metadata: { found: true } };
        }
        return { success: true, affectedEntityIds: [], provenanceId: `pw-wait-${Date.now()}` };
      },
    });
  }
}
