import type { SemanticEntity, EntityRole } from '@usir/protocol/entities';
import { createEntity } from '@usir/protocol/entities';

const TAG_ROLE_MAP: Record<string, EntityRole> = {
  A: 'ui_region',
  BUTTON: 'ui_region',
  INPUT: 'form_field',
  SELECT: 'form_field',
  TEXTAREA: 'form_field',
  FORM: 'form_field',
  IMG: 'ui_region',
  VIDEO: 'ui_region',
  CANVAS: 'ui_region',
  NAV: 'panel',
  HEADER: 'panel',
  FOOTER: 'panel',
  ASIDE: 'panel',
  MAIN: 'panel',
  SECTION: 'panel',
  ARTICLE: 'document',
  P: 'document',
  H1: 'document',
  H2: 'document',
  H3: 'document',
  TABLE: 'data_table',
  DIALOG: 'ui_region',
};

const VISIBLE_ROLES = new Set([
  'button', 'a', 'input', 'select', 'textarea', 'img', 'video',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'label',
  'td', 'th', 'nav', 'header', 'footer', 'main', 'aside', 'section',
  'article', 'dialog', 'canvas',
]);

function isVisible(element: Element): boolean {
  if (!VISIBLE_ROLES.has(element.tagName.toLowerCase())) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isInViewport(rect: DOMRect): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return rect.left < vw && rect.top < vh && rect.right > 0 && rect.bottom > 0;
}

function buildElementId(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList).map((c) => `.${c}`).join('');
  const nth = element.parentElement
    ? Array.from(element.parentElement.children).indexOf(element) + 1
    : 1;
  return `dom://${tag}${id}${classes}[${nth}]`;
}

function getRoleForElement(element: Element): EntityRole {
  const tag = element.tagName.toUpperCase();
  const role = element.getAttribute('role');
  if (role === 'button' || role === 'tab' || role === 'menuitem') return 'ui_region';
  if (role === 'dialog' || role === 'alertdialog') return 'ui_region';
  if (role === 'form' || role === 'search') return 'form_field';
  if (role === 'navigation') return 'panel';
  if (role === 'main' || role === 'region') return 'panel';
  const ariaRole = element.getAttribute('aria-role');
  if (ariaRole === 'button') return 'ui_region';
  return TAG_ROLE_MAP[tag] ?? 'unknown';
}

function getDisplayName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  const title = element.getAttribute('title');
  if (title) return title;
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return placeholder;
  const text = element.textContent?.trim().slice(0, 80);
  if (text) return text;
  return `<${element.tagName.toLowerCase()}>`;
}

function getAttributes(element: Element): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const attr of element.attributes) {
    if (['id', 'class', 'style', 'aria-label', 'title', 'role', 'placeholder'].includes(attr.name)) continue;
    attrs[attr.name] = attr.value;
  }
  attrs.tagName = element.tagName.toLowerCase();
  return attrs;
}

function getElementContext(element: Element): Record<string, unknown> {
  const rect = element.getBoundingClientRect();
  return {
    tagName: element.tagName.toLowerCase(),
    href: (element as HTMLAnchorElement).href || undefined,
    src: (element as HTMLImageElement).src || undefined,
    alt: element.getAttribute('alt') || undefined,
    type: element.getAttribute('type') || undefined,
    boundingRect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    childCount: element.children.length,
    textLength: element.textContent?.trim().length ?? 0,
  };
}

export function elementToEntity(element: Element, parentId?: string): SemanticEntity {
  const rect = element.getBoundingClientRect();
  const entity = createEntity({
    id: buildElementId(element),
    role: getRoleForElement(element),
    displayName: getDisplayName(element),
    spatial: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    context: getElementContext(element),
    attributes: getAttributes(element),
  });
  if (parentId) {
    entity.relations = [{ kind: 'child_of', targetId: parentId }];
  }
  return entity;
}

function walkDom(
  element: Element,
  parentEntityId: string | null,
  depth: number,
  maxDepth: number,
  entities: SemanticEntity[],
): void {
  if (depth > maxDepth) return;
  if (!isVisible(element)) return;
  const entity = elementToEntity(element, parentEntityId ?? undefined);
  entities.push(entity);
  for (const child of element.children) {
    walkDom(child as HTMLElement, entity.id, depth + 1, maxDepth, entities);
  }
}

export function buildDomGraph(root: Element, maxDepth: number = 10): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  walkDom(root, null, 0, maxDepth, entities);
  return entities;
}

export function buildViewportEntities(root: Element): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node): number {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!VISIBLE_ROLES.has(tag)) return NodeFilter.FILTER_SKIP;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
      if (!isInViewport(rect)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    entities.push(elementToEntity(node as Element));
  }
  return entities;
}
