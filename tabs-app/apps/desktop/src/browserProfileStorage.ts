import { normalizeProfileIdentifier } from "./profileStorage";
import { isSessionLikeCookieName } from "./browserAccountMarker";
import { isGoogleBrowserPage, isGoogleSignInCookie } from "./browserPageGrant";
import { BrowserSessionImporter } from "./browserImport/BrowserSessionImporter";
import { deriveBrowserPartition, extractProfileIdFromPartition } from "./profileStorage";
import { session as electronSession, type Session } from "electron";
import { randomUUID } from "node:crypto";
import type {
  BrowserProfileInspection,
  BrowserImportInput,
  BrowserImportResult,
} from "@tabs/contracts";
import { revokeScreenshotAttempts } from "./browserDeviceScreenshots";
import type { BrowserHostManager } from "./browserHostManager";

export async function clearProfileData(this: BrowserHostManager, profileId: string): Promise<void> {
  const trimmed = normalizeBrowserProfileId(profileId);
  const partition = deriveBrowserPartition({ profileId: trimmed });
  const s = electronSession.fromPartition(partition);
  this.observeProfileSession(partition, s);
  this.recordPartition(partition);
  await this.changingStorage(
    s,
    () => true,
    async () => {
      await this.clearPartitionData(s);
      for (const session of this.sessions.values()) {
        if (session.partition === partition && session.currentUrl) {
          await this.loadUrl(session, session.currentUrl);
        }
      }
    },
  );
}

export async function clearSessionData(
  this: BrowserHostManager,
  projectId: string,
  sessionId?: string,
): Promise<void> {
  const browserSession = this.sessions.get(this.sessionKey(projectId, sessionId));
  if (!browserSession) {
    throw new Error("Browser session is not available.");
  }
  this.recordPartition(browserSession.partition);
  const storageSession = browserSession.view.webContents.session;
  await this.changingStorage(
    storageSession,
    () => true,
    async () => {
      await this.clearPartitionData(storageSession);
      if (browserSession.currentUrl) {
        await this.loadUrl(browserSession, browserSession.currentUrl);
      }
    },
  );
}

export async function clearPartitionData(
  this: BrowserHostManager,
  storage: Session,
): Promise<void> {
  await storage.closeAllConnections();
  await storage.clearData({
    dataTypes: [
      "cache",
      "cookies",
      "fileSystems",
      "indexedDB",
      "localStorage",
      "serviceWorkers",
      "webSQL",
    ],
  });
  storage.flushStorageData();
  await storage.cookies.flushStore();
}

export async function inspectProfile(
  this: BrowserHostManager,
  profileId: string,
): Promise<BrowserProfileInspection> {
  const trimmed = normalizeBrowserProfileId(profileId);
  const partition = deriveBrowserPartition({ profileId: trimmed });
  const s = electronSession.fromPartition(partition);
  this.recordPartition(partition);
  this.observeProfileSession(partition, s);

  const isPersistent =
    typeof (s as any).isPersistent === "function"
      ? Boolean((s as any).isPersistent())
      : partition.startsWith("persist:");
  const storagePath =
    typeof (s as any).getStoragePath === "function" ? (s as any).getStoragePath() : null;

  const cookies = await s.cookies.get({});
  const map = new Map<string, { count: number; hasSessionHint: boolean }>();

  const AUTH_COOKIE_NAMES = [
    "sid",
    "hsid",
    "ssid",
    "apisid",
    "sapisid",
    "osid",
    "user_session",
    "logged_in",
    "dotcom_user",
    "__secure-next-auth.session-token",
    "auth_token",
    "figma.session",
    "figma.login",
    "linear_session",
    "token_v2",
    "jwt",
    "sessionid",
  ];

  let totalCookies = 0;
  for (const cookie of cookies) {
    totalCookies += 1;
    let domain = cookie.domain || "";
    if (domain.startsWith(".")) domain = domain.slice(1);
    if (!domain) continue;

    const existing = map.get(domain) ?? { count: 0, hasSessionHint: false };
    existing.count += 1;

    const cName = cookie.name.toLowerCase();
    const hasSessionHint =
      AUTH_COOKIE_NAMES.some((name) => cName === name || cName.includes(name)) ||
      cName.includes("session") ||
      cName.includes("token") ||
      cName.includes("auth");

    if (hasSessionHint) {
      existing.hasSessionHint = true;
    }
    map.set(domain, existing);
  }

  const domains = Array.from(map.entries())
    .map(([domain, data]) => ({
      domain,
      cookieCount: data.count,
      hasSessionHint: data.hasSessionHint,
    }))
    .toSorted((a, b) => {
      if (a.hasSessionHint && !b.hasSessionHint) return -1;
      if (!a.hasSessionHint && b.hasSessionHint) return 1;
      return a.domain.localeCompare(b.domain);
    });

  return {
    profileId: trimmed,
    partition,
    isPersistent,
    storagePath,
    totalDomains: domains.length,
    totalCookies,
    domains,
    inspectedAt: Date.now(),
  };
}

export async function clearProfileDomain(
  this: BrowserHostManager,
  profileId: string,
  domainToClear: string,
): Promise<void> {
  const trimmed = normalizeBrowserProfileId(profileId);
  const domain = normalizeBrowserCookieDomain(domainToClear);
  const partition = deriveBrowserPartition({ profileId: trimmed });
  const s = electronSession.fromPartition(partition);
  this.observeProfileSession(partition, s);
  await this.changingStorage(
    s,
    (url) => siteMatchesDomain(url, domain),
    async () => {
      try {
        const cookies = await s.cookies.get({});
        for (const cookie of cookies) {
          const cDomain = (cookie.domain || "").replace(/^\./, "").toLowerCase();
          if (cDomain === domain || cDomain.endsWith("." + domain)) {
            const protocol = cookie.secure ? "https:" : "http:";
            const url = `${protocol}//${cDomain}${cookie.path || "/"}`;
            await s.cookies.remove(url, cookie.name);
          }
        }
        await s.closeAllConnections();
        await s.clearData({
          origins: [`https://${domain}`, `http://${domain}`],
          dataTypes: [
            "cookies",
            "fileSystems",
            "indexedDB",
            "localStorage",
            "serviceWorkers",
            "webSQL",
          ],
          originMatchingMode: "third-parties-included",
        });
        s.flushStorageData();
        await s.cookies.flushStore();
        for (const session of this.sessions.values()) {
          if (
            session.partition === partition &&
            session.currentUrl &&
            siteMatchesDomain(session.currentUrl, domain)
          ) {
            await this.loadUrl(session, session.currentUrl);
          }
        }
      } catch (err) {
        console.error("[browserHostManager] Failed to clear profile domain:", err);
      }
    },
  );
}

export async function importBrowserCookies(
  this: BrowserHostManager,
  input: BrowserImportInput,
): Promise<BrowserImportResult> {
  const importer = new BrowserSessionImporter();
  const requestId = input.requestId ?? crypto.randomUUID();
  if (this.browserImports.has(requestId)) throw new Error("This import is already running.");
  const controller = new AbortController();
  this.browserImports.set(requestId, controller);
  let finishStorageChange: (() => void) | undefined;
  try {
    return await importer.importSelectedCookies(
      input,
      (partition) => {
        const storage = electronSession.fromPartition(partition);
        this.observeProfileSession(partition, storage);
        const finish = this.beginStorageChange(storage);
        finishStorageChange = () => {
          this.lastProfileImport.set(storage, performance.timeOrigin + performance.now());
          finish();
        };
        this.invalidateStorageGrants(storage, () => true);
        return storage;
      },
      controller.signal,
    );
  } finally {
    finishStorageChange?.();
    this.browserImports.delete(requestId);
  }
}

export function observeProfileSession(
  this: BrowserHostManager,
  partition: string,
  s: Session,
): void {
  const profileId = extractProfileIdFromPartition(partition);
  if (this.observedProfileSessions.has(s)) {
    return;
  }
  this.observedProfileSessions.add(s);
  s.cookies.on("changed", (_event, cookie) => {
    const googleSignIn = isGoogleSignInCookie(cookie);
    // Google sign-in cookies already revoke through their own rule.
    const scope = httpOnlyCookieScope({
      domain: cookie.domain,
      hostOnly: cookie.hostOnly,
      httpOnly: cookie.httpOnly,
      ...(!googleSignIn && cookie.name ? { name: cookie.name } : {}),
    });
    const affected = scope
      ? (url: string) => {
          const host = cookieSiteHostname(url);
          return !!host && cookieScopeMatchesHost(scope, host);
        }
      : undefined;
    if (scope) {
      let changes = this.lastHttpOnlyCookieChanges.get(s);
      if (!changes) {
        changes = new Map();
        this.lastHttpOnlyCookieChanges.set(s, changes);
      }
      changes.set(scope, performance.timeOrigin + performance.now());
    }
    if (googleSignIn || affected)
      this.invalidateStorageGrants(
        s,
        (url) => (googleSignIn && isGoogleBrowserPage(url)) || affected?.(url) === true,
        affected,
      );
    const window = this.getWindow();
    if (!profileId || !window || window.isDestroyed()) return;
    window.webContents.send("desktop:browser-host:profile-data-changed", profileId);
  });
}

export function lastHttpOnlyCookieChange(
  this: BrowserHostManager,
  storage: Session,
  url: string,
): number | undefined {
  const changes = this.lastHttpOnlyCookieChanges.get(storage);
  const host = changes && cookieSiteHostname(url);
  if (!changes || !host) return;
  let latest: number | undefined;
  for (const [scope, changedAt] of changes) {
    if (cookieScopeMatchesHost(scope, host) && (latest === undefined || changedAt > latest))
      latest = changedAt;
  }
  return latest;
}

export function invalidateStorageGrants(
  this: BrowserHostManager,
  storage: Session,
  affected: (url: string) => boolean,
  cookieAffected?: (url: string) => boolean,
): void {
  for (const session of this.sessions.values()) {
    const contents = session.view.webContents;
    if (contents.isDestroyed() || contents.session !== storage) continue;
    if (cookieAffected && session.screenshotDrafts)
      session.screenshotDrafts = session.screenshotDrafts.filter(
        (draft) => draft.verifiedUrl || !cookieAffected(draft.url),
      );
    if (session.resting) continue;
    if (
      !affected(contents.getURL()) &&
      !(session.pageGrant && affected(session.pageGrant.origin)) &&
      !(session.quickActionScope && affected(session.quickActionScope.origin))
    )
      continue;

    session.controlEpoch++;
    session.pageRevision = (session.pageRevision ?? 0) + 1;
    session.pageGrant = undefined;
    session.demonstration = undefined;
    session.returningDemonstration = undefined;
    session.lastScreen = undefined;
    session.actionTimeline = [];
    session.workflowSubmission = undefined;
    session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
    this.revokeScreenshotAttempts(session);
    session.deviceUploads?.clear();
    session.quickAction?.navigated();
    this.emitState(session);
  }
}

export function normalizeBrowserProfileId(profileId: string): string {
  return normalizeProfileIdentifier(profileId);
}

export function normalizeBrowserCookieDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\./u, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes("..") ||
    !/^[a-z0-9.-]+$/u.test(normalized)
  ) {
    throw new Error("Invalid browser cookie domain.");
  }
  return normalized;
}

export function siteMatchesDomain(url: string, domain: string): boolean {
  const hostname = URL.parse(url)?.hostname.replace(/\.$/u, "");
  return hostname === domain || hostname?.endsWith(`.${domain}`) === true;
}

export function cookieSiteHostname(url: string): string | undefined {
  const page = URL.parse(url);
  if (page?.protocol === "http:" || page?.protocol === "https:")
    return page.hostname.replace(/\.$/u, "");
}

// A leading dot represents a domain cookie. Track the whole host scope because
// a cookie on an API path can change the account used by an already loaded page.
export function httpOnlyCookieScope({
  domain,
  hostOnly,
  httpOnly,
  name,
}: {
  domain?: string | undefined;
  hostOnly?: boolean | undefined;
  httpOnly?: boolean | undefined;
  name?: string | undefined;
}): string | undefined {
  if ((!httpOnly && !(name && isSessionLikeCookieName(name))) || !domain) return;
  const host = domain.toLowerCase().replace(/^\./u, "").replace(/\.$/u, "");
  if (host) return (hostOnly ?? !domain.startsWith(".")) ? host : `.${host}`;
}

export function cookieScopeMatchesHost(scope: string, host: string): boolean {
  return (
    host === scope || (scope.startsWith(".") && (host === scope.slice(1) || host.endsWith(scope)))
  );
}
