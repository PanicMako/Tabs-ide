/** Read-only browser function shared by the embedded preview and Playwright MCP. */
export const TESTING_LOCATOR_DOM_FUNCTION = String.raw`(() => {
  const quote = (value) => JSON.stringify(value);
  const unique = (selector) => document.querySelectorAll(selector).length === 1;
  const pathFor = (element) => {
    const parts = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      if (current.id && unique('#' + CSS.escape(current.id))) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      const tag = current.localName;
      const siblings = current.parentElement ? [...current.parentElement.children].filter((sibling) => sibling.localName === tag) : [current];
      parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''));
    }
    return parts.join(' > ');
  };
  const selectors = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role],[tabindex],[contenteditable="true"],[data-testid],[data-test-id],[data-test],[data-cy],h1,h2,h3,h4,h5,h6,label,img,table,thead,tbody,tr,th,td,caption,fieldset,legend,output,progress,meter,video,audio,canvas,p,li';
  const elements = [];
  for (const element of document.querySelectorAll(selectors)) {
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none' || element.closest('[aria-hidden="true"], [inert]')) continue;
    const tag = element.localName;
    const role = element.getAttribute('role') || ({ a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', input: ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', submit: 'button', button: 'button' })[element.type] || 'textbox', summary: 'button', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', img: 'img' })[tag] || (/^h[1-6]$/.test(tag) ? 'heading' : '');
    const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    const labels = element.labels ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
    const icon = element.querySelector('i[class],svg[data-icon]');
    const iconName = icon?.getAttribute('data-icon') || icon?.className || '';
    const rawName = element.getAttribute('aria-label') || labelledBy || labels || element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || element.textContent?.trim() || (typeof iconName === 'string' ? iconName : '') || role || tag;
    const name = rawName.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 160) || (typeof iconName === 'string' && iconName.trim()) || role || tag;
    let selector = '';
    let testId = '';
    for (const attr of ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'id', 'name', 'aria-label', 'placeholder', 'href']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const candidate = tag + '[' + attr + '=' + quote(value) + ']';
      if (unique(candidate)) {
        selector = candidate;
        if (attr === 'data-testid' && unique('[data-testid=' + quote(value) + ']')) testId = value;
        break;
      }
    }
    const fragile = !selector;
    selector ||= pathFor(element);
    elements.push({ selector, name, tag, role, testId, fragile, matchCount: document.querySelectorAll(selector).length });
  }
  return { url: location.href, language: document.documentElement.lang || navigator.language, elements };
})`;
