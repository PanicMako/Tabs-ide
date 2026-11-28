import {
  BROWSER_QUICK_ACTION_MAX_FILE_BYTES,
  BROWSER_QUICK_ACTION_ROLES,
  type BrowserQuickActionSemantic,
} from "@tabs/contracts";
import { PRIVATE_BROWSER_FIELD } from "./browserPageGrant";
import {
  isBrowserQuickActionName,
  isBrowserQuickActionSelector,
} from "@tabs/shared/browserQuickAction";

/** The recording and pointer repair use the same limited DOM locator vocabulary. */
export const QUICK_ACTION_SELECTOR_SCRIPT = String.raw`
  const safeSelector = ${isBrowserQuickActionSelector.toString()};
  const safeName = ${isBrowserQuickActionName.toString()};
  const protectedField = (element) => element.isContentEditable || element.matches('input[type=file]') || (${PRIVATE_BROWSER_FIELD})(element);
  const visible = element => element instanceof HTMLElement && element.getClientRects().length &&
    !element.closest('[aria-hidden="true"],[inert]') && getComputedStyle(element).visibility === 'visible' &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const semanticElements = 'button,a[href],summary,input,select,textarea,section,h1,h2,h3,h4,h5,h6,output,[role]';
  const roles = ${JSON.stringify(BROWSER_QUICK_ACTION_ROLES)};
  const cleanName = name => (name || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const recordedName = element => {
    const labelledBy = element.getAttribute('aria-labelledby')?.trim().split(/\s+/u);
    return labelledBy?.map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ') ||
      element.getAttribute('aria-label') || '';
  };
  const semanticFor = element => {
    if (!(element instanceof HTMLElement)) return undefined;
    const tag = element.localName;
    const inputRoles = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button',
      text: 'textbox', email: 'textbox', search: 'textbox', url: 'textbox', tel: 'textbox' };
    const implicit = tag === 'input' ? inputRoles[element.type] :
      ({ button: 'button', a: 'link', summary: 'button', select: 'combobox', textarea: 'textbox', section: 'region', output: 'status' })[tag] ||
      (/^h[1-6]$/.test(tag) ? 'heading' : '');
    const role = element.getAttribute('role')?.trim().split(/\s+/u)[0] || implicit;
    if (!roles.includes(role)) return undefined;
    const name = cleanName(recordedName(element) ||
      Array.from(element.labels || [], label => label.innerText).join(' ') ||
      ((role === 'button' || role === 'link') && tag !== 'input' ? element.innerText : ''));
    if (!safeName(name)) return undefined;
    const grouping = '[role=group],[role=region],[role=dialog],fieldset,section,form';
    let group = '';
    for (let ancestor = element.parentElement?.closest(grouping); ancestor && !group; ancestor = ancestor.parentElement?.closest(grouping)) {
      group = cleanName(recordedName(ancestor) || ancestor.querySelector(':scope > legend')?.innerText);
    }
    if (group && !safeName(group)) return undefined;
    return { role, name, ...(group ? { group } : {}) };
  };
  const selectorFor = (element, allowFallback = false) => {
    if (!(element instanceof HTMLElement) || protectedField(element)) return '';
    const tag = element.localName;
    const selectors = [];
    for (const name of ['data-testid', 'data-test', 'data-cy']) {
      if (element.hasAttribute(name)) selectors.push('[' + name + '="' + element.getAttribute(name) + '"]');
    }
    if (element.id) selectors.push('#' + element.id);
    if (element.hasAttribute('name')) selectors.push(tag + '[name="' + element.getAttribute('name') + '"]');
    if (allowFallback) {
      if (element.hasAttribute('role')) selectors.push(tag + '[role="' + element.getAttribute('role') + '"]');
      selectors.push(...[...element.classList].map(name => '.' + name));
    }
    return selectors.find(selector => safeSelector(selector) && document.querySelectorAll(selector).length === 1) || '';
  };
`;

interface QuickActionDomStep {
  readonly action: string;
  readonly selector: string;
  readonly semantic?: BrowserQuickActionSemantic | undefined;
  readonly tag?: string | undefined;
  readonly value?: string | undefined;
  readonly expectedFilename?: string | undefined;
  readonly verifyFile?:
    | {
        readonly allowWebsiteDownloads: boolean;
        readonly revealToken?: string;
        readonly captureBaseline?: true;
      }
    | undefined;
  readonly revealFileToken?: string | undefined;
}

const READ_QUICK_ACTION_FILE = String.raw`
  const fileScope = href => {
    if (!URL.canParse(href)) return null;
    const url = new URL(href);
    const authenticationPath = /(?:^|\/)(?:auth|authorize|login|oauth|signin|sso)(?:\/|$)/i;
    if (url.protocol === 'data:' || (url.protocol === 'blob:' && url.origin === origin)) return 'local';
    if (step.verifyFile.allowWebsiteDownloads &&
      (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin &&
      !url.username && !url.password && !authenticationPath.test(url.pathname)) return 'website';
    return null;
  };
  const readFile = async (href, isCurrent) => {
    const pageUrl = location.href;
    const scope = fileScope(href);
    if (!scope) return 'file-scope';
    const websiteFile = scope === 'website';
    const maxBytes = ${BROWSER_QUICK_ACTION_MAX_FILE_BYTES};
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1600);
    try {
      const response = await fetch(href, {
        mode: 'same-origin', credentials: websiteFile ? 'same-origin' : 'omit',
        redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: abort.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      const disposition = response.headers.get('content-disposition') || '';
      const extended = /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i.exec(disposition);
      const simple = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition);
      if (!extended && /(?:^|;)\s*filename\*\s*=/i.test(disposition)) return 'file-filename';
      const serverName = extended ? decodeURIComponent(extended[1].trim()) : (simple?.[1] ?? simple?.[2]?.trim());
      if (!response.ok || response.status === 206 || !response.body ||
          Number(response.headers.get('content-length')) > maxBytes ||
          (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType) &&
            !/\.(?:html?|xhtml)$/i.test(step.expectedFilename))) return 'file-unavailable';
      if (serverName !== undefined && serverName !== step.expectedFilename) return 'file-filename';

      const reader = response.body.getReader();
      const chunks = [];
      let byteLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > maxBytes) return 'file-unavailable';
        chunks.push(value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = crypto.subtle ? await crypto.subtle.digest('SHA-256', bytes) : undefined;
      if (location.href !== pageUrl) return 'scope';
      if (!isCurrent()) return 'file-changed';
      if (digest) {
        const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return { filename: step.expectedFilename, byteLength, sha256, websiteFile };
      }
      // Web Crypto requires a secure context. Hash these bounded bytes in the host.
      let binary = '';
      for (let start = 0; start < byteLength; start += 8192)
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      return { filename: step.expectedFilename, byteLength, base64: btoa(binary), websiteFile };
    } catch {
      return 'file-unavailable';
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  };
  const baselineLinks = () => new Set(
    Array.from(document.querySelectorAll('a[href][download]'))
      .filter(link => link.getAttribute('download') === step.expectedFilename &&
        visible(link) && fileScope(link.href))
      .map(link => link.href),
  );
  const captureBaseline = async () => {
    const links = baselineLinks();
    if (links.size > 4) return 'file-baseline-unavailable';
    const results = await Promise.all(Array.from(links, href => readFile(href, () => true)));
    const current = baselineLinks();
    if (current.size !== links.size || Array.from(links).some(href => !current.has(href)))
      return 'file-baseline-unavailable';
    return results;
  };
  const verifyFile = async (element, findTarget) => {
    const href = element.href;
    const result = await readFile(href, () => findTarget() === element && element.href === href &&
      element.getAttribute('download') === step.expectedFilename);
    if (typeof result === 'object' && step.verifyFile.revealToken)
      globalThis.__tabsQuickActionFileTarget = { token: step.verifyFile.revealToken, element, href };
    return result;
  };
`;

/** Each mutation rechecks its target in the same isolated-world task. */
export function browserQuickActionProbe(origin: string, step: QuickActionDomStep): string {
  return String.raw`(() => {
    ${QUICK_ACTION_SELECTOR_SCRIPT}
    const origin = ${JSON.stringify(origin)};
    const step = ${JSON.stringify(step)};
    if (location.origin !== origin || /(?:^|\/)(?:auth|authorize|login|oauth|signin|sso)(?:\/|$)/i.test(location.pathname))
      return 'scope';
    if (document.readyState === 'loading') return 'missing';
    ${step.verifyFile ? READ_QUICK_ACTION_FILE : ""}
    ${step.verifyFile?.captureBaseline ? "return captureBaseline();" : ""}
    const findTarget = () => {
      const matches = step.selector ? document.querySelectorAll(step.selector) : [];
      if (matches.length > 1) return 'ambiguous';
      let element = matches[0];
      if (step.semantic) {
        const candidates = [];
        for (const candidate of document.querySelectorAll(semanticElements)) {
          const identity = semanticFor(candidate);
          if (identity?.role !== step.semantic.role || identity.name !== step.semantic.name ||
              (step.semantic.group && identity.group !== step.semantic.group) || !visible(candidate)) continue;
          candidates.push(candidate);
          if (candidates.length > 1) return 'ambiguous';
        }
        if (element && candidates[0] !== element && visible(element)) return 'changed';
        element = candidates[0];
      }
      if (!(element instanceof HTMLElement) || (!step.semantic && step.tag && element.localName !== step.tag)) return 'missing';
      if (protectedField(element)) return 'blocked';
      if (!visible(element)) return 'missing';
      return element;
    };
    const element = findTarget();
    if (typeof element === 'string') return element;
    if (step.action === 'assertVisible') {
      if (step.expectedFilename !== undefined &&
          (!(element instanceof HTMLAnchorElement) || !element.hasAttribute('href') ||
            element.getAttribute('download') !== step.expectedFilename)) return 'wrong-filename';
      if (step.revealFileToken) {
        const saved = globalThis.__tabsQuickActionFileTarget;
        delete globalThis.__tabsQuickActionFileTarget;
        if (saved?.token !== step.revealFileToken || saved.element !== element || saved.href !== element.href)
          return 'file-changed';
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return 'ok';
      }
      ${step.verifyFile ? "return verifyFile(element, findTarget);" : "return 'ok';"}
    }
    if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[inert]')) return 'blocked';
    const link = element.closest('a[href]');
    const form = element.form;
    const isSubmit = step.action === 'click' && form && ['submit', 'image'].includes(element.type);
    const permitsDestination = (url, target) => {
      const destination = new URL(url, location.href);
      return destination.origin === origin && !destination.username && !destination.password &&
        (!target || target === '_self');
    };
    if ((link && !permitsDestination(link.href, link.target || document.querySelector('base[target]')?.target)) ||
        (isSubmit && (!permitsDestination(element.getAttribute('formaction') || form.action,
          element.getAttribute('formtarget') || form.target) || [...form.elements].some(protectedField))))
      return 'scope';
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || (hit !== element && !element.contains(hit))) return 'blocked';
    if (step.action === 'click') {
      HTMLElement.prototype.click.call(element);
    } else if (step.action === 'fill') {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
        : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : null;
      if (!prototype || (element instanceof HTMLInputElement &&
        !['text','search','email','tel','url','number','date','month','week','time','datetime-local'].includes(element.type))
        || element.readOnly) return 'blocked';
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, step.value);
      if (element.value !== step.value) return 'uncertain';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (step.action === 'selectOption') {
      if (!(element instanceof HTMLSelectElement) || element.multiple ||
          ![...element.options].some(option => option.value === step.value && !option.matches(':disabled')))
        return 'blocked';
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, step.value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (step.action === 'check' || step.action === 'uncheck') {
      if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type) ||
          (element.type === 'radio' && step.action === 'uncheck')) return 'blocked';
      const checked = step.action === 'check';
      if (element.checked !== checked) HTMLElement.prototype.click.call(element);
      if (element.checked !== checked) return 'uncertain';
    } else return 'blocked';
    return 'ok';
  })()`;
}

export function browserQuickActionPicker(origin: string): string {
  return String.raw`(() => new Promise(resolve => {
    ${QUICK_ACTION_SELECTOR_SCRIPT}
    if (location.origin !== ${JSON.stringify(origin)}) return resolve(null);
    const hint = document.createElement('div');
    hint.textContent = 'Choose the control · Esc to cancel';
    Object.assign(hint.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '8px 12px', color: 'white', background: '#222',
      font: '12px system-ui', pointerEvents: 'none'
    });
    document.documentElement.append(hint);
    const pointerEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup'];
    const suppressPointer = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const finish = (result) => {
      clearTimeout(timer);
      for (const type of pointerEvents) window.removeEventListener(type, suppressPointer, true);
      window.removeEventListener('click', pick, true);
      window.removeEventListener('keydown', cancel, true);
      hint.remove();
      resolve(result);
    };
    const pick = (event) => {
      if (!event.isTrusted || !(event.target instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = event.target.closest('button,a[href],input,textarea,select,summary,[role]') || event.target;
      finish(protectedField(element) ? null : {
        selector: selectorFor(element, true), tag: element.localName, semantic: semanticFor(element),
      });
    };
    const cancel = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    const timer = setTimeout(() => finish(null), 30_000);
    for (const type of pointerEvents) window.addEventListener(type, suppressPointer, true);
    window.addEventListener('click', pick, true);
    window.addEventListener('keydown', cancel, true);
  }))()`;
}
