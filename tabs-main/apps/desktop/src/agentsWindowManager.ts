import { BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { CodeHostManager, type CodeHostConfig } from "./codeHostManager";
import type { NativeCodeHostMainBackend } from "./nativeCodeHostMain";
import type { NativeAgentsWindowPayload } from "./nativeCodeHostOpen";

export interface AgentsWindowRecord {
  window: BrowserWindow;
  host: CodeHostManager;
  content?: WebContents;
  readyPromise: Promise<void>;
  ready(): void;
  reject(error: Error): void;
}

export class AgentsWindowManager {
  private readonly windows = new Map<number, AgentsWindowRecord>();
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

    // Existing-session precedence & Single-window reuse:
    // If an Agents window is already open, bring it to the front and deliver
    // the new handoff intent rather than spawning duplicate windows on the
    // same agents.code-workspace.
    const existingEntry = [...this.windows.entries()].find(([, rec]) => !rec.window.isDestroyed());
    if (existingEntry) {
      const [, existing] = existingEntry;
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      await existing.readyPromise;
      if (existing.window.isDestroyed()) throw new Error("Agents window closed before handoff");
      if (!existing.content || existing.content.isDestroyed())
        throw new Error("Agents renderer closed before handoff");
      existing.content.send(
        "vscode:selectAgentsFolder",
        payload.folderUri,
        payload.sessionResource,
        payload.source,
        payload.folderUriIsDefault,
        payload.draft,
        payload.onboardingSessionResource,
      );
      existing.content.focus();
      return;
    }

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

    let isClosing = false;
    let hasFlushed = false;
    const flushHost = async () => {
      if (hasFlushed) return;
      hasFlushed = true;
      try {
        await host.flushAndShutdownSessions();
      } catch (error) {
        console.error("[agents-window] shutdown failed", error);
      }
    };

    window.on("close", (event) => {
      if (isClosing || this.stopping) return;
      isClosing = true;
      event.preventDefault();
      rejectReady(new Error("Agents window closed before handoff"));
      clearTimeout(timeout);
      if (content) this.windows.delete(content.id);
      void (async () => {
        try {
          await flushHost();
        } finally {
          if (!window.isDestroyed()) {
            window.destroy();
          }
        }
      })();
    });

    window.once("closed", () => {
      rejectReady(new Error("Agents window closed before handoff"));
      clearTimeout(timeout);
      if (content) this.windows.delete(content.id);
      if (!this.stopping && !hasFlushed) {
        void flushHost();
      }
    });

    const record: AgentsWindowRecord = {
      window,
      host,
      readyPromise: ready,
      ready: resolveReady,
      reject: rejectReady,
    };

    host.setNativeWebContentsRegistrar((webContents, bounds, projectId) => {
      content = webContents;
      record.content = webContents;
      this.windows.set(webContents.id, record);
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
        try {
          await host.flushAndShutdownSessions();
        } finally {
          if (!window.isDestroyed()) window.destroy();
        }
      }),
    );
    this.windows.clear();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, "Agents window shutdown failed");
  }
}
