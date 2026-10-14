import type { DesktopBrowserSessionState } from "@tabs/contracts";
export type BrowserBridge = NonNullable<Window["desktopBridge"]>;
export function normalizeCompanionUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a website or localhost address.");
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(input) &&
    !/^https?:/i.test(input) &&
    !/^[^:/?#]+:\d+(?:[/?#]|$)/i.test(input)
  )
    throw new Error("Use an HTTP or HTTPS address.");
  const candidate = /^https?:\/\//i.test(input)
    ? input
    : input.startsWith("//")
      ? `https:${input}`
      : /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(?:\/|$)/i.test(input)
        ? `http://${input}`
        : `https://${input}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Use an HTTP or HTTPS address.");
  if (url.username || url.password) throw new Error("Use an address without embedded credentials.");
  return url.href;
}
export function emptyBrowserState(
  projectId: string,
  sessionId: string,
): DesktopBrowserSessionState {
  return {
    projectId,
    sessionId,
    currentUrl: null,
    pageTitle: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    zoomFactor: 1,
    audioMuted: false,
    pictureInPicture: false,
    colorScheme: "system",
    lastError: null,
    transientError: null,
  };
}
/** Native events are authoritative. History never navigates to a stored React URL. */
export class CompanionBrowserSession {
  private disposed = false;
  private unsubscribe: (() => void) | undefined;
  readonly input: { projectId: string; sessionId: string };
  constructor(
    private bridge: BrowserBridge,
    projectId: string,
    sessionId: string,
    private onState: (state: DesktopBrowserSessionState) => void,
  ) {
    this.input = { projectId, sessionId };
  }
  async start(initialUrl: string) {
    this.unsubscribe?.();
    this.unsubscribe = this.bridge.onBrowserSessionState((state) => {
      if (
        !this.disposed &&
        state.projectId === this.input.projectId &&
        state.sessionId === this.input.sessionId
      )
        this.onState(state);
    });
    const host = await this.bridge.getBrowserHostState();
    if (this.disposed) return;
    if (!host.available)
      throw new Error(host.reason ?? "Native browsing is unavailable in this client.");
    await this.bridge.ensureBrowserSession({
      ...this.input,
      initialUrl: normalizeCompanionUrl(initialUrl),
    });
    if (this.disposed) return;
    const state = await this.bridge.getBrowserSessionState(this.input);
    if (this.disposed) return;
    this.onState(state);
    await this.bridge.activateBrowserSession(this.input);
  }
  navigate(url: string) {
    return this.bridge.navigateBrowserSession({ ...this.input, url: normalizeCompanionUrl(url) });
  }
  back() {
    return this.bridge.goBackBrowserSession(this.input);
  }
  forward() {
    return this.bridge.goForwardBrowserSession(this.input);
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    void this.bridge
      .setBrowserBounds({ ...this.input, x: 0, y: 0, width: 0, height: 0, visible: false })
      .catch(() => undefined);
  }
}
