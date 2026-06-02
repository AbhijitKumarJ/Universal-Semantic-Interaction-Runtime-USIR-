/**
 * DOM Extractor — a self-contained script that runs inside the Playwright
 * page context via page.evaluate(). It mirrors the browser adapter's
 * elementToEntity logic but as a serializable string.
 */

export const DOM_EXTRACTOR_SCRIPT = `
() => {
  const TAG_ROLE_MAP = {
    A: 'ui_region', BUTTON: 'ui_region', INPUT: 'form_field',
    SELECT: 'form_field', TEXTAREA: 'form_field', FORM: 'form_field',
    IMG: 'ui_region', VIDEO: 'ui_region', CANVAS: 'ui_region',
    NAV: 'panel', HEADER: 'panel', FOOTER: 'panel', ASIDE: 'panel',
    MAIN: 'panel', SECTION: 'panel', ARTICLE: 'document',
    P: 'document', H1: 'document', H2: 'document', H3: 'document',
    TABLE: 'data_table', DIALOG: 'ui_region',
  };

  const VISIBLE_TAGS = new Set([
    'button','a','input','select','textarea','img','video',
    'p','h1','h2','h3','h4','h5','h6','li','span','label',
    'td','th','nav','header','footer','main','aside','section',
    'article','dialog','canvas',
  ]);

  function isVisible(el) {
    if (!VISIBLE_TAGS.has(el.tagName.toLowerCase())) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isInViewport(r) {
    return r.left < window.innerWidth && r.top < window.innerHeight && r.right > 0 && r.bottom > 0;
  }

  function buildId(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = Array.from(el.classList).map(function(c) { return '.' + c; }).join('');
    const nth = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) + 1 : 1;
    return 'dom://' + tag + id + cls + '[' + nth + ']';
  }

  function getRole(el) {
    const tag = el.tagName.toUpperCase();
    const role = el.getAttribute('role');
    if (role === 'button' || role === 'tab' || role === 'menuitem') return 'ui_region';
    if (role === 'dialog' || role === 'alertdialog') return 'ui_region';
    if (role === 'form' || role === 'search') return 'form_field';
    if (role === 'navigation') return 'panel';
    if (role === 'main' || role === 'region') return 'panel';
    return TAG_ROLE_MAP[tag] || 'unknown';
  }

  function getDisplayName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const title = el.getAttribute('title');
    if (title) return title;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const text = (el.textContent || '').trim().slice(0, 80);
    if (text) return text;
    return '<' + el.tagName.toLowerCase() + '>';
  }

  function toEntity(el, parentId) {
    const r = el.getBoundingClientRect();
    var context = {
      tagName: el.tagName.toLowerCase(),
      href: el.href || undefined,
      src: el.src || undefined,
      alt: el.getAttribute('alt') || undefined,
      type: el.getAttribute('type') || undefined,
      boundingRect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
      childCount: el.children.length,
      textLength: (el.textContent || '').trim().length || 0,
    };
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (['id','class','style','aria-label','title','role','placeholder'].indexOf(attr.name) >= 0) continue;
      attrs[attr.name] = attr.value;
    }
    attrs.tagName = el.tagName.toLowerCase();
    var entity = {
      id: buildId(el),
      role: getRole(el),
      displayName: getDisplayName(el),
      context: context,
      spatial: { x: r.left, y: r.top, width: r.width, height: r.height },
      attributes: attrs,
      relations: parentId ? [{ kind: 'child_of', targetId: parentId }] : [],
      updatedAt: Date.now(),
      source: 'playwright',
    };
    return entity;
  }

  function walk(root, parentId, depth, maxDepth, entities) {
    if (depth > maxDepth) return;
    if (!isVisible(root)) return;
    var entity = toEntity(root, parentId || undefined);
    entities.push(entity);
    for (var i = 0; i < root.children.length; i++) {
      walk(root.children[i], entity.id, depth + 1, maxDepth, entities);
    }
  }

  function extractViewport() {
    var entities = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isVisible(el)) continue;
      var r = el.getBoundingClientRect();
      if (!isInViewport(r)) continue;
      entities.push(toEntity(el, null));
    }
    return entities;
  }

  function extractFull(maxDepth) {
    var entities = [];
    if (document.body) {
      for (var i = 0; i < document.body.children.length; i++) {
        walk(document.body.children[i], null, 0, maxDepth || 10, entities);
      }
    }
    return entities;
  }

  return { extractViewport: extractViewport(), extractFull: extractFull() };
}`;

export interface DomExtractResult {
  extractViewport: Array<Record<string, unknown>>;
  extractFull: Array<Record<string, unknown>>;
}

export function parseDomResult(raw: unknown): DomExtractResult {
  const r = raw as DomExtractResult;
  return {
    extractViewport: Array.isArray(r?.extractViewport) ? r.extractViewport : [],
    extractFull: Array.isArray(r?.extractFull) ? r.extractFull : [],
  };
}
