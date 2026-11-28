/** Locator expressions run inside the Chromium guest. Ambiguous input is left to the user. */
export function pageTargetExpression(input: Record<string, unknown>) {
  const selector = typeof input.selector === "string" ? input.selector : null;
  const locator = typeof input.locator === "string" ? input.locator : null;
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const locator = ${JSON.stringify(locator)};
    const unique = elements => {
      if (elements.length > 1) throw new Error("Several controls match. Choose a more specific target or demonstrate one.");
      return elements[0] ?? null;
    };
    if (selector) return unique(document.querySelectorAll(selector));
    if (!locator) return document.activeElement;
    const visible = element => element.checkVisibility({visibilityProperty: true});
    const clean = value => (value || "").trim().replace(/\\s+/g, " ");
    if (locator.startsWith("text=")) {
      const text = clean(locator.slice(5));
      const matching = [...document.querySelectorAll("body *")].filter(element =>
        element instanceof HTMLElement && visible(element) && clean(element.innerText).includes(text));
      const exact = matching.filter(element => clean(element.innerText) === text);
      const candidates = exact.length ? exact : matching;
      const matches = new Set(candidates);
      const ancestors = new Set();
      for (const node of candidates) for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (matches.has(parent)) ancestors.add(parent);
      }
      return unique(candidates.filter(element => !ancestors.has(element)));
    }
    const roleMatch = /^role=([a-z]+)(?:\\[name=['"]?(.+?)['"]?\\])?$/.exec(locator);
    if (roleMatch) {
      const [, role, name] = roleMatch;
      const native = {button:'button,input[type=button],input[type=submit]',link:'a[href]',
        checkbox:'input[type=checkbox]',radio:'input[type=radio]',combobox:'select',
        textbox:'textarea,input:not([type]),input[type=text],input[type=email],input[type=search]'};
      const elements = document.querySelectorAll('[role="'+role+'"],'+(native[role] || role));
      return unique([...elements].filter(element => visible(element) && (!name ||
        clean(element.getAttribute("aria-label") || (element.getAttribute("aria-labelledby") || "").split(/\\s+/)
          .map(id => document.getElementById(id)?.textContent).join(" ").trim() ||
          element.labels?.[0]?.textContent || element.innerText || element.getAttribute("title")) === name)));
    }
    return unique(document.querySelectorAll(locator));
  })()`;
}

/** Snapshot paths use each element's own sibling index and round-trip through querySelector. */
export const SNAPSHOT_SELECTOR = `(element, { maxLength = Infinity, includeIds = true } = {}) => {
  const parts = [];
  let length = 0;
  for (let node = element; node; node = node.parentElement) {
    const separator = parts.length ? 3 : 0;
    if (includeIds && node.id && node.id.length < maxLength) {
      const id = '#' + CSS.escape(node.id);
      if (length + separator + id.length <= maxLength && document.querySelectorAll(id).length === 1) {
        parts.unshift(id);
        break;
      }
    }
    let ordinal = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling)
      if (sibling.localName === node.localName) ordinal++;
    const part = CSS.escape(node.localName) + ':nth-of-type(' + ordinal + ')';
    length += separator + part.length;
    if (length > maxLength) break;
    parts.unshift(part);
  }
  return parts.join(' > ');
}`;

/** Resolve known text in the top document without collecting other text for the reply. */
export function snapshotTextMatchesExpression(texts: readonly string[]) {
  return `(() => {
    const texts = ${JSON.stringify(texts)};
    const selectorFor = ${SNAPSHOT_SELECTOR};
    // Count elements and text so complex receipt pages fit while large DOMs have a traversal cap.
    const maxNodes = 10000;
    const maxTextWork = 1000000;
    const groups = new Map(texts.map(text => [text, { targets: [], ambiguous: false }]));
    const incomplete = () => texts.map(text => ({
      text, status: groups.get(text).ambiguous ? 'ambiguous' : 'unobservable'
    }));
    if (!document.documentElement) return incomplete();

    const elements = new Map();
    const entries = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let visited = 0;
    let textLength = 0;
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (++visited > maxNodes) return incomplete();
      const parent = elements.get(node.parentElement);
      if (node.nodeType === Node.TEXT_NODE) {
        if (!parent?.rendersText) continue;
        textLength += node.length;
        if (textLength > maxTextWork) return incomplete();
        parent.work += 1 + node.length;
        // A textarea's source text does not appear in its ancestors' innerText.
        if (parent.excluded && parent.visible && parent.element.localName !== 'textarea' && node.data.trim()) {
          parent.containsExcludedText = true;
        }
        continue;
      }
      const style = getComputedStyle(node);
      const entry = {
        element: node,
        parent,
        work: 1,
        rendersText: (parent?.rendersText ?? true) && style.display !== 'none' && style.contentVisibility !== 'hidden',
        visible: style.visibility === 'visible',
        excluded: parent?.excluded || style.opacity === '0' || node.isContentEditable ||
          node.matches('[hidden], [inert], [aria-hidden="true" i], input, textarea, select, [role="textbox" i]'),
        containsExcludedText: false,
      };
      elements.set(node, entry);
      entries.push(entry);
    }

    let work = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const { element, parent, rendersText, visible, excluded, containsExcludedText, work: subtreeWork } = entries[i];
      // innerText can include text from an inert, aria-hidden, transparent, or editable child.
      if (parent) {
        parent.work += subtreeWork;
        if (containsExcludedText) parent.containsExcludedText = true;
      }
      if (!(element instanceof HTMLElement) || !rendersText || !visible || excluded || containsExcludedText ||
          !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) continue;
      // Reading innerText on nested elements can revisit the same rendered content many times.
      work += subtreeWork;
      if (work > maxTextWork) return incomplete();
      const group = groups.get(element.innerText.trim());
      if (!group || group.ambiguous) continue;
      const deepest = group.targets[0];
      if (deepest && !element.contains(deepest)) group.ambiguous = true;
      else group.targets.push(element);
    }

    return texts.map(text => {
      const { targets, ambiguous } = groups.get(text);
      if (ambiguous) return { text, status: 'ambiguous' };
      if (!targets.length) return { text, status: 'not_found' };
      for (const element of targets) {
        const selector = selectorFor(element, { maxLength: 300, includeIds: false });
        if (!selector || selector.length > 300) continue;
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === element) return { text, status: 'matched', selector };
      }
      return { text, status: 'unobservable' };
    });
  })()`;
}
