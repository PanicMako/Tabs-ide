/**
 * Loopback control channel between the Electron main process and the bundled
 * `tabs-workbench-integration` extension running inside the Code-OSS extension
 * host.
 *
 * Why this exists: Tabs controls outside the Code tool need to drive the
 * embedded workbench and reflect its state. The workbench window exposes no
 * command accessor, so the only place we can
 * call `vscode.commands.executeCommand` is the extension host. Main is the
 * natural broker: it owns the embedded WebContentsView and desktopBridge IPC.
 *
 * Transport: a raw TCP server (`node:net`) bound to 127.0.0.1 on an ephemeral
 * port, speaking newline-delimited JSON. Deliberately NOT WebSocket: the
 * extension host replaces `globalThis.WebSocket` with @vscode/proxy-agent's
 * patched constructor, which can hang indefinitely on loopback URLs — raw TCP
 * has no proxy layer, no patching, and both ends of this channel are ours.
 *
 * Auth: a per-launch random token, sent in-band as the first (`hello`) message;
 * connections that send anything else first are destroyed. The connection info
 * is handed to the extension via env vars and a JSON file. The file lets a
 * long-lived native extension host re-read the current port after a main-process
 * restart.
 *
 * Routing: one connection per project — the `hello` carries the projectId the
 * desktop set in the server's env, and commands are forwarded only to that
 * project's socket, so several open projects can't clobber each other.
 */
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as Path from "node:path";
import type { AddressInfo } from "node:net";

import {
  CODE_CHROME_COMMAND_ALLOWLIST,
  parseCodeControlClientMessage,
  type CodeChromeState,
  type CodeControlServerMessage,
} from "@tabs/shared/codeChrome";

// Hard cap on a connection's unframed buffer: control messages are tiny, so
// anything larger is a misbehaving or hostile local client.
const MAX_BUFFERED_BYTES = 1_000_000;

const VIEW_COMMAND_REGEX = /^workbench\.view(\.extension)?\.[A-Za-z0-9._-]+$/;

export class CodeControlChannel {
  private server: Net.Server | null = null;
  // One connection per project (keyed by the projectId the extension announces
  // in its `hello`). A single shared socket would let multiple open projects
  // clobber each other, routing a click to the wrong editor.
  private readonly socketsByProject = new Map<string, Net.Socket>();
  private readonly projectBySocket = new Map<Net.Socket, string>();
  private readonly dynamicAllowedCommandsByProject = new Map<string, Set<string>>();
  private readonly latestChromeStateByProject = new Map<string, CodeChromeState>();
  private token = "";
  private port = 0;
  private readonly chromeStateListeners: ((projectId: string, state: CodeChromeState) => void)[] =
    [];
  private readonly openTabsProjectTabListeners: ((projectId: string) => void)[] = [];
  private extensionHostConnectedListener: ((projectId: string) => void) | null = null;
  private readonly extensionHostWaiters = new Map<
    string,
    Set<{ resolve: () => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>
  >();
  private urlFilePath: string | null = null;
  private currentThemeState: {
    theme: string;
    customConfig?: unknown;
    fontPreferences?: unknown;
  } | null = null;

  /**
   * Start the loopback control server. Idempotent — repeated calls return the
   * already-resolved connection info. Resolves once the server is listening.
   *
   * When `urlFilePath` is provided, the live `{ url, token }` is written there
   * (atomically) so a long-lived extension host can re-read the current target
   * on each reconnect — surviving a main-process restart on a new port.
   */
  start(urlFilePath?: string): Promise<{ url: string; token: string }> {
    if (this.server) {
      return Promise.resolve({ url: this.url(), token: this.token });
    }
    this.urlFilePath = urlFilePath ?? null;
    this.token = Crypto.randomBytes(24).toString("hex");
    const server = Net.createServer((socket) => this.handleConnection(socket));
    this.server = server;

    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        this.writeUrlFile();
        resolve({ url: this.url(), token: this.token });
      });
    });
  }

  private handleConnection(socket: Net.Socket): void {
    let authed = false;
    let buffer = "";
    socket.setNoDelay(true);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_BUFFERED_BYTES) {
        socket.destroy();
        return;
      }
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (line.length === 0) {
          continue;
        }
        const message = parseCodeControlClientMessage(line);
        if (!message) {
          continue;
        }
        // Token check: the first message must be a `hello` carrying the exact
        // per-launch token; anything else gets the connection destroyed.
        if (!authed) {
          if (message.type !== "hello" || message.token !== this.token) {
            socket.destroy();
            return;
          }
          authed = true;
          this.registerForProject(message.projectId, socket);
          // Notify manager: the extension host + remoteFilesystem client are now running.
          // This is the correct moment to send openFile — not at loadURL time.
          this.extensionHostConnectedListener?.(message.projectId);
          continue;
        }
        if (message.type === "chromeState") {
          this.latestChromeStateByProject.set(message.projectId, message.state);
          const allowed = new Set<string>();
          if (message.state.activityBarItems) {
            for (const item of message.state.activityBarItems) {
              if (VIEW_COMMAND_REGEX.test(item.commandId)) {
                allowed.add(item.commandId);
              }
            }
          }
          this.dynamicAllowedCommandsByProject.set(message.projectId, allowed);
          for (const listener of this.chromeStateListeners) {
            listener(message.projectId, message.state);
          }
        } else if (message.type === "openTabsProjectTab") {
          for (const listener of this.openTabsProjectTabListeners) {
            listener(message.projectId);
          }
        }
      }
    });

    const cleanup = () => {
      const projectId = this.projectBySocket.get(socket);
      if (projectId !== undefined) {
        this.projectBySocket.delete(socket);
        if (this.socketsByProject.get(projectId) === socket) {
          this.socketsByProject.delete(projectId);
          this.dynamicAllowedCommandsByProject.delete(projectId);
        }
      }
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private registerForProject(projectId: string, socket: Net.Socket): void {
    // Supersede only a prior socket for the SAME project (e.g. a reconnect
    // after the workbench reloaded), never a different project's socket.
    const existing = this.socketsByProject.get(projectId);
    if (existing && existing !== socket) {
      try {
        existing.destroy();
      } catch {
        /* ignore */
      }
      this.projectBySocket.delete(existing);
    }
    this.socketsByProject.set(projectId, socket);
    this.projectBySocket.set(socket, projectId);
    if (this.currentThemeState) {
      const message = { type: "setTheme", ...this.currentThemeState };
      socket.write(`${JSON.stringify(message)}\n`);
    }
    const waiters = this.extensionHostWaiters.get(projectId);
    if (waiters) {
      this.extensionHostWaiters.delete(projectId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve();
      }
    }
  }

  isExtensionHostConnected(projectId: string): boolean {
    const socket = this.socketsByProject.get(projectId);
    return Boolean(socket && !socket.destroyed && socket.writable);
  }

  waitForExtensionHost(projectId: string, timeoutMs = 60_000): Promise<void> {
    if (this.isExtensionHostConnected(projectId)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const waiters = this.extensionHostWaiters.get(projectId);
          waiters?.delete(waiter);
          if (waiters?.size === 0) {
            this.extensionHostWaiters.delete(projectId);
          }
          reject(
            new Error(
              `Tabs' Code-OSS integration extension did not connect within ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs),
      };
      const waiters = this.extensionHostWaiters.get(projectId) ?? new Set();
      waiters.add(waiter);
      this.extensionHostWaiters.set(projectId, waiters);
    });
  }

  /** Persist the live URL/token for the extension to re-read on reconnect. */
  private writeUrlFile(): void {
    if (!this.urlFilePath) return;
    try {
      FS.mkdirSync(Path.dirname(this.urlFilePath), { recursive: true });
      // Write to a temp file then rename so a reader never sees a partial write.
      const tmp = `${this.urlFilePath}.${process.pid}.tmp`;
      FS.writeFileSync(tmp, JSON.stringify({ url: this.url(), token: this.token }), "utf8");
      FS.renameSync(tmp, this.urlFilePath);
    } catch {
      // Non-fatal: the extension falls back to the env URL.
    }
  }

  /** Register the callback invoked whenever an extension pushes chrome state. */
  onChromeState(listener: (projectId: string, state: CodeChromeState) => void): void {
    this.chromeStateListeners.push(listener);
  }

  /** Register the callback invoked when an extension requests a new Tabs project tab. */
  onOpenTabsProjectTab(listener: (projectId: string) => void): void {
    this.openTabsProjectTabListeners.push(listener);
  }

  /** Register a callback fired the moment an extension host connects (hello handshake). */
  onExtensionHostConnected(listener: (projectId: string) => void): void {
    this.extensionHostConnectedListener = listener;
  }

  /**
   * Forward an allowlisted command to a specific project's extension. Returns
   * true if that project had a live connection and the (allowed) command was
   * sent. Routing by project keeps a click on one editor from driving another.
   */
  runCommand(projectId: string, commandId: string): boolean {
    const isStaticAllowed = CODE_CHROME_COMMAND_ALLOWLIST.includes(commandId);
    const projectDynamicAllowed = this.dynamicAllowedCommandsByProject.get(projectId);
    const isDynamicAllowed = projectDynamicAllowed?.has(commandId) ?? false;

    if (!isStaticAllowed && !isDynamicAllowed) {
      return false;
    }
    const socket = this.socketsByProject.get(projectId);
    if (!socket || socket.destroyed || !socket.writable) {
      return false;
    }
    const message: CodeControlServerMessage = { type: "runCommand", commandId };
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  openFile(
    projectId: string,
    filePath: string,
    options?: {
      preview?: boolean | undefined;
      pinned?: boolean | undefined;
      preserveFocus?: boolean | undefined;
      viewColumn?: number | undefined;
      lineNumber?: number | undefined;
    },
  ): boolean {
    const socket = this.socketsByProject.get(projectId);
    if (!socket || socket.destroyed || !socket.writable) {
      return false;
    }
    const message: CodeControlServerMessage = { type: "openFile", filePath, ...options };
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  setTheme(theme: string, customConfig?: unknown, fontPreferences?: unknown): void {
    this.currentThemeState = { theme, customConfig, fontPreferences };
    const message = { type: "setTheme", theme, customConfig, fontPreferences };
    const payload = `${JSON.stringify(message)}\n`;
    for (const socket of this.socketsByProject.values()) {
      if (!socket.destroyed && socket.writable) {
        socket.write(payload);
      }
    }
  }

  getChromeState(projectId: string): CodeChromeState | null {
    return this.latestChromeStateByProject.get(projectId) ?? null;
  }

  url(): string {
    return `tcp://127.0.0.1:${this.port}/?token=${this.token}`;
  }

  dispose(): void {
    for (const socket of this.socketsByProject.values()) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    this.socketsByProject.clear();
    this.projectBySocket.clear();
    this.dynamicAllowedCommandsByProject.clear();
    for (const waiters of this.extensionHostWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Code-OSS control channel was disposed before startup completed."));
      }
    }
    this.extensionHostWaiters.clear();
    this.server?.close();
    this.server = null;
    this.chromeStateListeners.length = 0;
    if (this.urlFilePath) {
      try {
        FS.rmSync(this.urlFilePath, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
