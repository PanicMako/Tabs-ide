import type {
  BrowserComparisonInput,
  BrowserComparisonPane,
  DesktopPreviewScreenshotArtifact,
} from "@tabs/contracts";

interface ComparisonAdapter {
  configure(
    projectId: string,
    sessionId: string,
    pane: BrowserComparisonPane,
    sourceSessionId?: string,
  ): Promise<void>;
  navigate(projectId: string, sessionId: string, url: string): Promise<void>;
  scroll(
    projectId: string,
    sessionId: string,
    position?: { x: number; y: number },
  ): Promise<{ x: number; y: number }>;
  capture(projectId: string, sessionId: string): Promise<DesktopPreviewScreenshotArtifact>;
  destroy(projectId: string, sessionId: string): void;
  restore(projectId: string, sessionId?: string): Promise<void>;
}
type Group = {
  input: BrowserComparisonInput;
  ids: [string, string];
  positions: Array<{ x: number; y: number } | undefined>;
  timer?: ReturnType<typeof setInterval>;
  sampling: boolean;
  urls: [string, string];
};

/** Owns only comparison-created sessions, never the source/user tab. */
export class BrowserComparisonController {
  private readonly groups = new Map<string, Group>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly adapter: ComparisonAdapter) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  get active(): boolean {
    return this.groups.size > 0;
  }

  configure(input: BrowserComparisonInput): Promise<void> {
    return this.serial(async () => {
      if (
        !/^[a-zA-Z0-9-]{1,80}$/.test(input.comparisonId) ||
        !input.projectId ||
        !Array.isArray(input.panes) ||
        input.panes.length !== 2
      )
        throw new Error("Invalid comparison identity.");
      for (const pane of input.panes) {
        const url = new URL(pane.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new Error("Comparison requires HTTP(S) pages without URL credentials.");
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(pane.profileId))
          throw new Error("Select a browser profile.");
        for (const value of [pane.bounds.x, pane.bounds.y, pane.bounds.width, pane.bounds.height])
          if (!Number.isFinite(value)) throw new Error("Invalid comparison bounds.");
        if (pane.bounds.width <= 0 || pane.bounds.height <= 0)
          throw new Error("Comparison needs visible pane bounds.");
        for (const value of [pane.viewport.width, pane.viewport.height])
          if (!Number.isInteger(value) || value < 100 || value > 4000)
            throw new Error("Invalid comparison viewport.");
      }
      const key = `${input.projectId}:${input.comparisonId}`;
      let group = this.groups.get(key);
      if (!group) {
        group = {
          input,
          ids: [`comparison-${input.comparisonId}-a`, `comparison-${input.comparisonId}-b`],
          positions: [],
          sampling: false,
          urls: [input.panes[0].url, input.panes[1].url],
        };
        this.groups.set(key, group);
      }
      const previousInput = group.input;
      group.input = input;
      try {
        for (let index = 0; index < 2; index++) {
          const requested = input.panes[index]!;
          const pane =
            requested.url === previousInput.panes[index]!.url
              ? { ...requested, url: group.urls[index]! }
              : requested;
          group.urls[index] = pane.url;
          await this.adapter.configure(
            input.projectId,
            group.ids[index]!,
            pane,
            input.sourceSessionId,
          );
        }
        if (!group.timer)
          group.timer = setInterval(() => {
            void this.sample(group!).catch(() => undefined);
          }, 150);
      } catch (error) {
        await this.dispose(key, group);
        throw error;
      }
    });
  }

  navigated(projectId: string, sessionId: string, url: string): void {
    for (const group of this.groups.values()) {
      const index = group.ids.indexOf(sessionId);
      if (group.input.projectId !== projectId || index === -1) continue;
      group.urls[index] = url;
      group.positions[index] = undefined;
      if (!group.input.syncNavigation) return;
      const other = index === 0 ? 1 : 0;
      if (group.urls[other] === url) return;
      group.urls[other] = url;
      void this.serial(async () => {
        if (![...this.groups.values()].includes(group)) return;
        await this.adapter.navigate(projectId, group.ids[other], url);
      }).catch(() => undefined);
    }
  }

  private async sample(group: Group): Promise<void> {
    if (group.sampling || !group.input.syncScroll) return;
    group.sampling = true;
    try {
      const positions = await Promise.all(
        group.ids.map((id) => this.adapter.scroll(group.input.projectId, id)),
      );
      if (![...this.groups.values()].includes(group) || !group.input.syncScroll) return;
      const changed = positions.findIndex(
        (position, index) =>
          group.positions[index] &&
          (Math.abs(position.x - group.positions[index]!.x) > 0.002 ||
            Math.abs(position.y - group.positions[index]!.y) > 0.002),
      );
      group.positions = positions;
      if (changed >= 0) {
        const other = changed === 0 ? 1 : 0;
        group.positions[other] = await this.adapter.scroll(
          group.input.projectId,
          group.ids[other],
          positions[changed],
        );
      }
    } finally {
      group.sampling = false;
    }
  }

  capture(projectId: string, comparisonId: string): Promise<DesktopPreviewScreenshotArtifact[]> {
    return this.serial(async () => {
      const group = this.groups.get(`${projectId}:${comparisonId}`);
      if (!group) throw new Error("Comparison is closed.");
      return Promise.all(group.ids.map((id) => this.adapter.capture(projectId, id)));
    });
  }

  close(projectId: string, comparisonId: string): Promise<void> {
    return this.serial(async () => {
      const key = `${projectId}:${comparisonId}`;
      const group = this.groups.get(key);
      if (group) await this.dispose(key, group);
    });
  }

  private async dispose(key: string, group: Group): Promise<void> {
    this.groups.delete(key);
    if (group.timer) clearInterval(group.timer);
    for (const id of group.ids) this.adapter.destroy(group.input.projectId, id);
    await this.adapter.restore(group.input.projectId, group.input.sourceSessionId);
  }

  async closeAll(): Promise<void> {
    for (const group of [...this.groups.values()])
      await this.close(group.input.projectId, group.input.comparisonId);
  }
}
