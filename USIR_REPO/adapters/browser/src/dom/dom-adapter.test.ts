import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { elementToEntity, buildDomGraph, buildViewportEntities } from './dom-adapter';

function mockElement(overrides: Partial<Element> = {}): Element {
  const rect: DOMRect = { top: 10, left: 20, width: 100, height: 50, right: 120, bottom: 60, x: 20, y: 10, toJSON: () => {} };
  return {
    tagName: 'DIV',
    id: '',
    className: '',
    classList: [] as any,
    attributes: [] as any,
    textContent: 'hello world',
    children: [] as any,
    parentElement: null,
    getAttribute: vi.fn(),
    getBoundingClientRect: vi.fn().mockReturnValue(rect),
    querySelectorAll: vi.fn().mockReturnValue([]),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('window', {
    getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' }),
    innerWidth: 1024,
    innerHeight: 768,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('elementToEntity', () => {
  it('creates a SemanticEntity from a basic element', () => {
    const el = mockElement({ tagName: 'BUTTON', id: 'submit-btn' });
    const entity = elementToEntity(el);
    expect(entity.id).toContain('dom://button');
    expect(entity.id).toContain('#submit-btn');
    expect(entity.role).toBe('ui_region');
    expect(entity.displayName).toBe('hello world');
  });

  it('maps tag names to correct roles', () => {
    const tests = [
      { tag: 'A', role: 'ui_region' },
      { tag: 'P', role: 'document' },
      { tag: 'NAV', role: 'panel' },
      { tag: 'INPUT', role: 'form_field' },
      { tag: 'TABLE', role: 'data_table' },
      { tag: 'IMG', role: 'ui_region' },
    ];
    for (const { tag, role } of tests) {
      const el = mockElement({ tagName: tag });
      expect(elementToEntity(el).role).toBe(role);
    }
  });

  it('maps unknown tags to unknown role', () => {
    const el = mockElement({ tagName: 'WBR' });
    expect(elementToEntity(el).role).toBe('unknown');
  });

  it('uses aria-label as display name', () => {
    const el = mockElement({
      tagName: 'BUTTON',
      getAttribute: vi.fn((name: string) => name === 'aria-label' ? 'Submit' : null),
    });
    expect(elementToEntity(el).displayName).toBe('Submit');
  });

  it('uses title as display name fallback', () => {
    const el = mockElement({
      tagName: 'BUTTON',
      getAttribute: vi.fn((name: string) => name === 'title' ? 'Click me' : null),
    });
    expect(elementToEntity(el).displayName).toBe('Click me');
  });

  it('adds child_of relation when parentId provided', () => {
    const el = mockElement({ tagName: 'DIV' });
    const entity = elementToEntity(el, 'parent-1');
    expect(entity.relations).toHaveLength(1);
    expect(entity.relations[0].kind).toBe('child_of');
    expect(entity.relations[0].targetId).toBe('parent-1');
  });

  it('includes spatial bounds', () => {
    const el = mockElement({ tagName: 'DIV' });
    const entity = elementToEntity(el);
    expect(entity.spatial).toBeDefined();
    expect((entity.spatial as any)?.x).toBe(20);
    expect((entity.spatial as any)?.y).toBe(10);
    expect((entity.spatial as any)?.width).toBe(100);
    expect((entity.spatial as any)?.height).toBe(50);
  });

  it('includes element context', () => {
    const el = mockElement({ tagName: 'IMG', getAttribute: vi.fn() });
    const entity = elementToEntity(el);
    expect(entity.context).toBeDefined();
    expect((entity.context as any)?.tagName).toBe('img');
  });
});

describe('buildDomGraph', () => {
  it('walks DOM tree and returns entities', () => {
    const child = mockElement({ tagName: 'BUTTON', id: 'child' });
    const parent = mockElement({
      tagName: 'NAV',
      id: 'parent',
      children: [child] as any,
    });
    child.parentElement = parent;

    const entities = buildDomGraph(parent, 2);
    expect(entities.length).toBeGreaterThanOrEqual(2);
  });

  it('respects maxDepth', () => {
    const leaf = mockElement({ tagName: 'BUTTON', id: 'leaf' });
    const mid = mockElement({
      tagName: 'NAV', id: 'mid',
      children: [leaf] as any,
    });
    const root = mockElement({
      tagName: 'MAIN', id: 'root',
      children: [mid] as any,
    });
    leaf.parentElement = mid;
    mid.parentElement = root;

    const shallow = buildDomGraph(root, 1);
    const deep = buildDomGraph(root, 3);
    expect(shallow.length).toBeLessThan(deep.length);
  });
});

describe('buildViewportEntities', () => {
  it('returns entities for visible elements in viewport', () => {
    const inView = mockElement({ tagName: 'BUTTON', id: 'visible-btn' });
    vi.mocked(inView.querySelectorAll).mockReturnValue([inView] as any);

    const entities = buildViewportEntities(inView);
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('skips elements outside viewport', () => {
    const outsideRect: DOMRect = { top: -100, left: -100, width: 10, height: 10, right: -90, bottom: -90, x: -100, y: -100, toJSON: () => {} };
    const el = mockElement({
      tagName: 'DIV',
      getBoundingClientRect: vi.fn().mockReturnValue(outsideRect),
    });
    vi.mocked(el.querySelectorAll).mockReturnValue([el] as any);

    const entities = buildViewportEntities(el);
    expect(entities).toEqual([]);
  });
});
