import { BROWSER_SELECTION_DRAG_MIME, BROWSER_SELECTION_MAX_LENGTH } from "@tabs/shared/preview";
import { figmaFileLocation, isFigmaHostname } from "@tabs/shared/figmaUrl";
import { isLikelyAuthenticationUrl, sanitizeAuthUrl } from "./authClassifier";

export interface BrowserPageScope {
  readonly origin: string;
  readonly accountRoute: string | null;
  readonly resource: string | null;
  /** `/org/acme`-style tenant prefix. Absent or null means the grant covers the whole origin. */
  readonly tenant?: string | null;
}

export interface BrowserPageGrant extends BrowserPageScope {
  readonly taskId: string;
  readonly partition: string;
  /** What the approval covers, e.g. "all pages on https://example.com in the work profile". */
  readonly scopeLabel?: string;
}

function parseBrowserPage(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function pageOrigin(url: string): string | null {
  return parseBrowserPage(url)?.origin ?? null;
}

function isGoogleHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  return host === "google.com" || host.endsWith(".google.com");
}

export function isGoogleBrowserPage(url: string): boolean {
  const page = parseBrowserPage(url);
  return page !== null && isGoogleHostname(page.hostname);
}

const GOOGLE_SIGN_IN_COOKIE_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LSID",
  "OSID",
  "__Secure-1PSID",
  "__Secure-3PSID",
]);

export function isGoogleSignInCookie(cookie: {
  readonly name: string;
  readonly domain?: string;
}): boolean {
  const domain = cookie.domain?.replace(/^\./, "").toLowerCase();
  return Boolean(
    domain && isGoogleHostname(domain) && GOOGLE_SIGN_IN_COOKIE_NAMES.has(cookie.name),
  );
}

/** Google Workspace exposes the chosen account in its URL, including within one profile. */
function pageAccountRoute(url: URL): string | null {
  if (!isGoogleHostname(url.hostname)) return null;
  const path = [...url.pathname.matchAll(/(?:^|\/)u\/((?:\d|%3[0-9])+)(?=\/|$)/g)].map(([, slot]) =>
    decodeURIComponent(slot!),
  );
  const query = url.searchParams.getAll("authuser");
  const slots = new Set([...path, ...query]);
  // A query parameter must not hide a different slot in the path or a repeated parameter.
  if (slots.size > 1) return JSON.stringify({ path, query });
  return slots.size === 1 ? JSON.stringify([...slots][0]) : null;
}

function pageResource(url: URL): string | null {
  const hostname = url.hostname.replace(/\.$/, "");
  if (hostname === "docs.google.com") {
    const document = url.pathname.match(
      /^\/(document|spreadsheets|presentation)\/(?:u\/(?:\d|%3[0-9])+\/)?d\/(?:(e)\/)?([\w-]+)(?=\/|$)/,
    );
    if (document) {
      const [, app, published, id] = document;
      if (published || id !== "e") return published ? `${app}/d/e/${id}` : `${app}/d/${id}`;
    }
    return url.href;
  }
  if (isFigmaHostname(hostname)) {
    const file = figmaFileLocation(url);
    return file ? JSON.stringify([file.fileKey, file.branchParameters]) : url.href;
  }
  if (hostname === "partner.microsoft.com") return url.href;
  return null;
}

const TENANT_SEGMENTS = new Set([
  "org",
  "orgs",
  "o",
  "t",
  "team",
  "teams",
  "workspace",
  "workspaces",
  "w",
  "company",
  "tenant",
  "tenants",
]);

/** Apps that put the organisation in the first path segment scope a grant to that tenant. */
function pageTenant(url: URL): string | null {
  const [segment, value] = url.pathname.split("/").slice(1);
  if (!segment || !value || !TENANT_SEGMENTS.has(segment.toLowerCase())) return null;
  try {
    return `/${segment.toLowerCase()}/${decodeURIComponent(value).toLowerCase()}`;
  } catch {
    return `/${segment.toLowerCase()}/${value.toLowerCase()}`;
  }
}

/** Plain-language reach of a page grant, for the approval UI. */
export function describeBrowserPageScope(scope: BrowserPageScope, profileId?: string): string {
  const where = scope.tenant ? `${scope.origin}${scope.tenant}` : scope.origin;
  const reach = scope.resource
    ? `this document on ${scope.origin}`
    : scope.tenant
      ? `all pages under ${where}`
      : `all pages on ${where}`;
  return profileId ? `${reach} in the ${profileId} profile` : reach;
}

export function getBrowserPageScope(url: string): BrowserPageScope | null {
  const parsed = parseBrowserPage(url);
  if (!parsed || isLikelyAuthenticationUrl(url)) return null;
  return {
    origin: parsed.origin,
    accountRoute: pageAccountRoute(parsed),
    resource: pageResource(parsed),
    tenant: pageTenant(parsed),
  };
}

export function matchesPageScope(scope: BrowserPageScope, url: string): boolean {
  const candidate = getBrowserPageScope(url);
  return (
    candidate !== null &&
    candidate.origin === scope.origin &&
    candidate.accountRoute === scope.accountRoute &&
    candidate.resource === scope.resource &&
    (candidate.tenant ?? null) === (scope.tenant ?? null)
  );
}

/** The agent receives route identity without URL credentials, search parameters or fragments. */
export function grantedPageAddress(url: string) {
  return pageOrigin(url) ? sanitizeAuthUrl(url) : "";
}

/** Evaluated in the guest. Field values are never returned to the host. */
export const PRIVATE_BROWSER_FIELD = String.raw`(element => {
  if (!element.matches('input,textarea,select,[contenteditable=true],[role=textbox]')) return false;
  if (element.matches('input[type=password],[autocomplete~="current-password"],[autocomplete~="new-password"],[autocomplete~="one-time-code"],[autocomplete*="cc-"],[autocomplete*="bday"],[autocomplete~="webauthn"]')) return true;
  const field = [element.id, element.getAttribute('name'), element.getAttribute('aria-label'),
    element.getAttribute('placeholder'), ...Array.from(element.labels || [], label => label.textContent)]
    .filter(Boolean).join(' ');
  if (/pass(?:word|phrase|code)|api[-_ ]?key|access[-_ ]?token|secret|verification[-_ ]?code|security[-_ ]?code|one[-_ ]?time|card[-_ ]?number|social[-_ ]?security|date[-_ ]?of[-_ ]?birth|birth[-_ ]?(?:date|day)|tax[-_ ]?(?:id|number|identification)|routing[-_ ]?number|account[-_ ]?number|sort[-_ ]?code|passport|licen[sc]e[-_ ]?(?:number|no)|codice[-_ ]?fiscale|mot[-_ ]?de[-_ ]?passe|contrase(?:ñ|n)a|passwort|kennwort|personalausweis|senha|пароль|密码|パスワード|\b(?:otp|mfa|cvv|cvc|pin|ssn|dob|tin|ein|vat|iban|dni|nie|cpf|rg)\b/i.test(field)) return true;
  return Boolean(element.value) && element.matches('input[type=email],input[type=tel],[autocomplete~="email"],[autocomplete~="street-address"],[autocomplete~="postal-code"],[autocomplete~="tel"]');
})`;

/** Executed in a Chromium isolated world. Unknown frames require a human handoff. */
export const PAGE_READY_FOR_AGENT = `(() => {
  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden';
  const privateField = ${PRIVATE_BROWSER_FIELD};
  function inspect(root) {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && visible(element) && !inspect(element.shadowRoot)) return false;
      if (!visible(element)) continue;
      if (privateField(element)) return false;
      if (element.matches('iframe,frame') &&
          (!element.contentDocument || !inspect(element.contentDocument))) return false;
    }
    return true;
  }
  return inspect(document);
})()`;

/** Read only a visible DOM text selection. Editable fields stay inside the guest. */
export const READ_BROWSER_SELECTION = `(() => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.commonAncestorContainer.getRootNode() !== document || !range.getClientRects().length)
    return null;
  const fields = 'input,textarea,select,[contenteditable],[role=textbox],[role=combobox],[role=spinbutton]';
  const root = range.commonAncestorContainer;
  const element = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
  if (!element || element.closest(fields) || document.designMode === 'on') return null;
  for (const field of element.querySelectorAll(fields)) {
    if (range.intersectsNode(field)) return null;
  }
  const text = selection.toString();
  if (!text.trim() || text.length > ${BROWSER_SELECTION_MAX_LENGTH} || !(${PAGE_READY_FOR_AGENT})) return null;
  return text;
})()`;

export function browserSelectionDragScript(url: string, token: string) {
  return `(() => {
    const url = ${JSON.stringify(url)};
    if (location.href !== url) return;
    globalThis.tabsBrowserSelectionDrag?.abort();
    const controller = new AbortController();
    globalThis.tabsBrowserSelectionDrag = controller;
    document.addEventListener('dragstart', event => {
      const data = event.dataTransfer;
      if (!event.isTrusted || location.href !== url || !data || data.types.includes('text/uri-list')) return;
      const selection = window.getSelection();
      if (selection?.rangeCount !== 1 || selection.isCollapsed) return;
      const inside = Array.from(selection.getRangeAt(0).getClientRects()).some(rect =>
        event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom);
      if (!inside) return;
      const text = ${READ_BROWSER_SELECTION};
      if (text === null) return;
      data.setData('text/plain', text);
      data.setData(${JSON.stringify(BROWSER_SELECTION_DRAG_MIME)}, ${JSON.stringify(token)});
    }, { capture: true, signal: controller.signal });
  })()`;
}

/** Listen for one trusted activation and keep the local comparison inside the guest. */
export function demonstrateControlScript(url: string, token: string) {
  return `new Promise(resolve => {
    const controller = new AbortController();
    globalThis.tabsBrowserDemonstration?.clear();
    const token = ${JSON.stringify(token)};
    const record = { token, clear };
    globalThis.tabsBrowserDemonstration = record;
    function clear() {
      clearTimeout(timer);
      controller.abort();
      removeEventListener("pagehide", clear);
      if (globalThis.tabsBrowserDemonstration === record) delete globalThis.tabsBrowserDemonstration;
      resolve(null);
    }
    const timer = setTimeout(clear, 60000);
    addEventListener("pagehide", clear, { once: true, signal: controller.signal });
    document.addEventListener("click", event => {
      if (!event.isTrusted || location.href !== ${JSON.stringify(url)}) return;
      if (!(${PAGE_READY_FOR_AGENT})) { clear(); return; }
      const target = event.composedPath().find(node => node instanceof HTMLElement &&
        node.matches('button,[role="button"],a[href],[role="menuitem"],input[type="submit"]'));
      if (!target) return;
      controller.abort();
      addEventListener("pagehide", clear, { once: true });
      const clean = value => (value || '').trim().replace(/\\s+/g, ' ').slice(0, 96);
      const label = clean(target.getAttribute('aria-label') || target.innerText || target.getAttribute('title'));
      const group = target.closest('[role=group],fieldset,section,[role=dialog],form');
      const context = clean(group?.getAttribute('aria-label') || group?.querySelector('legend,h1,h2,h3')?.textContent);
      const key = ['data-testid','id','name'].map(name => [name, target.getAttribute(name)])
        .find(([, value]) => value && /^[a-z][a-z0-9_-]{0,63}$/i.test(value));
      const visible = element => element.isConnected && element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === 'visible' && !element.closest('[aria-hidden=true], [inert]');
      const neighborhood = group || target.parentElement;
      const state = () => ({
        visible: visible(target),
        expanded: target.getAttribute('aria-expanded'),
        pressed: target.getAttribute('aria-pressed'),
        disabled: target.matches(':disabled,[aria-disabled=true]'),
        controls: Array.from(neighborhood?.querySelectorAll('button,[role=button],[role=menuitem],a[href]') || [])
          .slice(0, 40).filter(visible),
        status: Array.from(neighborhood?.querySelectorAll('[role=status],[role=alert],[aria-live]:not([aria-live=off]),output') || [])
          .slice(0, 8).filter(visible).map(element => element.innerText.slice(0, 200)),
      });
      const before = state();
      record.read = () => {
        if (!(${PAGE_READY_FOR_AGENT})) return null;
        const after = state();
        return [
          before.visible && !after.visible && 'Control disappeared',
          after.visible && before.expanded !== after.expanded &&
            (after.expanded === 'true' ? 'Control expanded' : after.expanded === 'false' && 'Control collapsed'),
          after.visible && before.disabled !== after.disabled && (after.disabled ? 'Control disabled' : 'Control enabled'),
          after.visible && before.pressed !== after.pressed &&
            (after.pressed === 'true' ? 'Control pressed' : after.pressed === 'false' && 'Control released'),
          (before.controls.length !== after.controls.length || before.controls.some((node, index) => node !== after.controls[index])) && 'Nearby controls changed',
          JSON.stringify(before.status) !== JSON.stringify(after.status) && 'Nearby status changed',
        ].filter(Boolean);
      };
      resolve({ role: clean(target.getAttribute('role') || target.localName), label, context,
        ...(key ? { identifier: key.join('=') } : {}) });
    }, { capture: true, signal: controller.signal });
  })`;
}

export function readBrowserDemonstrationScript(url: string, token: string) {
  return `(() => {
    const record = globalThis.tabsBrowserDemonstration;
    if (location.href !== ${JSON.stringify(url)} || record?.token !== ${JSON.stringify(token)}) return null;
    try { return record.read?.() ?? null; }
    finally { record.clear(); }
  })()`;
}
