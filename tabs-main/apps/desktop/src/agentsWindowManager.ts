import { BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { CodeHostManager, type CodeHostConfig } from "./codeHostManager";
import type { NativeCodeHostMainBackend } from "./nativeCodeHostMain";
import type { NativeAgentsWindowPayload } from "./nativeCodeHostOpen";

export class AgentsWindowManager {
  private readonly windows = new Map<
    number,
    {
      window: BrowserWindow;
      host: CodeHostManager;
      ready(): void;
      reject(error: Error): void;
    }
  >();
  private stopping = false;

  constructor(
    private readonly config: CodeHostConfig,
    private readonly getBackend: () => NativeCodeHostMainBackend | null,
  ) {}

  notifyReady(webContents: WebContents): void {
    this.windows.get(webContents.id)?.ready();
  }

  async open(payload: NativeAgentsWindowPayload): Promise<void> {
    if (this.stopping) throw new Error("Agents window host is shutting down");
    const runtime = this.config.runtime;
    const backend = this.getBackend();
    if (!runtime || !backend || !this.config.state.available)
      throw new Error("Agents window host is unavailable");
    const workspaceRoot = Path.join(runtime.stateDir, "code-oss-desktop", "agents-workspace");
    const workspace = Path.join(workspaceRoot, "agents.code-workspace");
    FS.mkdirSync(workspaceRoot, { recursive: true });
    try {
      FS.writeFileSync(workspace, JSON.stringify({ folders: [] }), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "Tabs Agents",
      show: false,
      autoHideMenuBar: true,
    });
    const host = new CodeHostManager(
      () => window,
      { ...this.config, state: { ...this.config.state } },
      undefined,
      undefined,
      workspace,
    );
    let content: WebContents | undefined;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A window can close while ensureSession/activation is still pending.
    void ready.catch(() => undefined);
    const timeout = setTimeout(
      () => rejectReady(new Error("Agents renderer readiness timed out")),
      30_000,
    );
    window.once("closed", () => {
      rejectReady(new Error("Agents window closed before handoff"));
      clearTimeout(timeout);
      if (content) this.windows.delete(content.id);
      void host
        .flushAndShutdownSessions()
        .catch((error) => console.error("[agents-window] shutdown failed", error));
    });
    host.setNativeWebContentsRegistrar((webContents, bounds, projectId) => {
      content = webContents;
      this.windows.set(webContents.id, { window, host, ready: resolveReady, reject: rejectReady });
      backend.registerWebContents(webContents, bounds, window, projectId);
    });
    const projectId = `tabs-agents-${randomUUID()}`;
    const resize = () => {
      const [width = 0, height = 0] = window.getContentSize();
      host.setBounds({ projectId, x: 0, y: 0, width, height, visible: true });
    };
    window.on("resize", resize);
    try {
      await host.ensureSession({ projectId, workspaceRoot });
      resize();
      await host.activateSession({ projectId });
      await ready;
      if (!content || content.isDestroyed() || window.isDestroyed())
        throw new Error("Agents renderer closed before handoff");
      content.send(
        "vscode:selectAgentsFolder",
        payload.folderUri,
        payload.sessionResource,
        payload.source,
        payload.folderUriIsDefault,
        payload.draft,
        payload.onboardingSessionResource,
      );
      window.show();
      content.focus();
    } catch (error) {
      await host.flushAndShutdownSessions();
      if (!window.isDestroyed()) window.destroy();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const records = [...this.windows.values()];
    for (const record of records) record.reject(new Error("Agents window host is shutting down"));
    const results = await Promise.allSettled(
      records.map(async ({ host, window }) => {
        await host.flushAndShutdownSessions();
        if (!window.isDestroyed()) window.destroy();
      }),
    );
    this.windows.clear();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, "Agents window shutdown failed");
  }
}
