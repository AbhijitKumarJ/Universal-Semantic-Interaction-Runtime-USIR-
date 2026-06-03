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
    ownerDocument: null,
    getAttribute: vi.fn(),
    getBoundingClientRect: vi.fn().mockReturnValue(rect),
    querySelectorAll: vi.fn().mockReturnValue([]),
    ...overrides,
  } as any;
}

function mockTreeWalker(elements: Element[], filter?: NodeFilter | null): TreeWalker {
  let idx = 0;
  const f = filter ?? { acceptNode: () => NodeFilter.FILTER_ACCEPT };
  return {
    root: elements[0] ?? null as any,
    whatToShow: NodeFilter.SHOW_ELEMENT,
    filter: f as any,
    currentNode: null as any,
    nextNode: () => {
      while (idx < elements.length) {
        const node = elements[idx++];
        const result = f.acceptNode(node);
        if (result === NodeFilter.FILTER_ACCEPT) {
          return node;
        }
      }
      return null;
    },
    previousNode: () => null,
    firstChild: () => null,
    lastChild: () => null,
    nextSibling: () => null,
    previousSibling: () => null,
    parentNode: () => null,
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {
    getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' }),
    innerWidth: 1024,
    innerHeight: 768,
  });
  vi.stubGlobal('document', {
    createTreeWalker: (_root: Node, _whatToShow: number, filter: NodeFilter | null) => {
      // Called at runtime — use the actual filter from the implementation
      return mockTreeWalker([]);
    },
  });
  vi.stubGlobal('NodeFilter', {
    SHOW_ELEMENT: 1,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
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
  let capturedFilter: NodeFilter | null = null;

  beforeEach(() => {
    capturedFilter = null;
  });

  function withDoc(el: Element): Element {
    el.ownerDocument = {
      createTreeWalker: (_root: Node, _whatToShow: number, filter: NodeFilter | null) => {
        capturedFilter = filter;
        return mockTreeWalker([el], filter);
      },
    } as any;
    return el;
  }

  it('returns entities for visible elements in viewport', () => {
    const inView = withDoc(mockElement({ tagName: 'BUTTON', id: 'visible-btn' }));

    const entities = buildViewportEntities(inView);
    expect(entities.length).toBeGreaterThanOrEqual(1);
    expect(entities[0].role).toBe('ui_region');
  });

  it('skips elements outside viewport', () => {
    const outsideRect: DOMRect = { top: -100, left: -100, width: 10, height: 10, right: -90, bottom: -90, x: -100, y: -100, toJSON: () => {} };
    const el = withDoc(mockElement({
      tagName: 'BUTTON',
      getBoundingClientRect: vi.fn().mockReturnValue(outsideRect),
    }));

    const entities = buildViewportEntities(el);
    expect(entities).toEqual([]);
  });

  it('skips non-VISIBLE_ROLES elements', () => {
    const el = withDoc(mockElement({ tagName: 'SCRIPT' }));

    const entities = buildViewportEntities(el);
    expect(entities).toEqual([]);
  });
});
