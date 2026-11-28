/**
 * Detects a change of the signed-in account on an approved page. Only a SHA-256 of the
 * visible identity hints is ever kept; the hint text itself never leaves the guest and is
 * never sent to the model.
 */

export const ACCOUNT_MARKER_MESSAGE =
  "The signed-in account on this page changed. Review access again.";

/**
 * Evaluated in the guest. Resolves to comma-separated SHA-256 digests, one per visible identity
 * hint, or null when no hint exists. Hashing each hint separately lets ordinary navigation that
 * shows other people's addresses keep the grant while the signed-in identity stays visible.
 */
export const ACCOUNT_MARKER_SCRIPT = String.raw`(async () => {
  if (!crypto.subtle) return null;
  const email = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden';
  const hints = new Set();
  const add = value => { const text = clean(value); if (text) hints.add(text); };
  const addEmails = text => { for (const match of String(text || '').match(email) || []) add(match); };

  const roots = new Set(document.querySelectorAll('header,nav,[role=banner],[role=navigation]'));
  for (const element of document.body ? document.body.querySelectorAll('*') : []) {
    if (roots.size > 200) break;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < 120 && rect.height < 120) roots.add(element);
  }
  let scanned = 0;
  for (const root of roots) {
    if (++scanned > 200) break;
    if (visible(root)) addEmails(root.innerText);
  }
  const labelled = '[aria-label],[title]';
  for (const element of document.querySelectorAll(labelled)) {
    if (hints.size > 50) break;
    for (const name of ['aria-label', 'title']) {
      const value = element.getAttribute(name);
      if (value && /account|signed in as|profile/i.test(value) && visible(element)) {
        add(value);
        addEmails(value);
      }
    }
  }
  for (const image of document.querySelectorAll('img[alt]')) {
    const alt = image.getAttribute('alt') || '';
    if (alt.includes('@') && visible(image)) add(alt);
  }
  for (const element of document.querySelectorAll('[data-email],[data-user],[data-account]'))
    for (const name of ['data-email', 'data-user', 'data-account']) add(element.getAttribute(name));
  if (hints.size === 0) return null;
  const digests = await Promise.all([...hints].sort().slice(0, 50).map(async hint => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hint));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }));
  return [...new Set(digests)].sort().join(',');
})()`;

export function parseAccountMarker(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}(?:,[a-f0-9]{64})*$/u.test(value)
    ? value
    : null;
}

/**
 * The account changed when identity hints were visible at approval and now, but none of the
 * approved hints remain. Absence is not a change.
 */
export function accountMarkerChanged(approved: string | null, current: string | null): boolean {
  if (approved === null || current === null) return false;
  const remaining = new Set(current.split(","));
  return !approved.split(",").some((hash) => remaining.has(hash));
}

const SESSION_COOKIE =
  /(?:^|[^a-z])(?:sid|session(?:id)?|auth|token|jwt|login|user)(?:[^a-z]|$)|session|jwt|auth/i;
const ROTATING_COOKIE = /csrf|xsrf|analytics|_ga|_gid/i;

/** Non-HttpOnly cookies that look like a session or login also reveal an account switch. */
export function isSessionLikeCookieName(name: string): boolean {
  return SESSION_COOKIE.test(name) && !ROTATING_COOKIE.test(name);
}
