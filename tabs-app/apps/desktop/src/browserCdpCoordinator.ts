import type { Debugger, WebContents } from "electron";

export type CdpOwner = "none" | "automation" | "emulation" | "devtools" | "recording";

/** One persistent, serialized debugger connection per page. Keeping the connection
 * alive preserves emulation overrides and recorder bindings between commands. */
export class BrowserCdpCoordinator {
  private owner: CdpOwner = "none";
  private ownsAttachment = false;
  private devToolsOpen = false;
  private generation = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly interruptions = new Set<() => void>();

  constructor(private readonly contents: WebContents) {
    contents.debugger.on("detach", () => this.handleDetach());
  }

  onInterrupted(listener: () => void): () => void {
    this.interruptions.add(listener);
    return () => this.interruptions.delete(listener);
  }

  handleDevToolsOpened(): void {
    if (!this.devToolsOpen) {
      this.devToolsOpen = true;
      this.detach();
    }
    this.owner = "devtools";
  }

  prepareForDevTools(): void {
    this.handleDevToolsOpened();
  }

  handleDevToolsClosed(): void {
    this.devToolsOpen = false;
    this.owner = "none";
  }

  handleDetach(_reason?: string): void {
    this.generation++;
    this.ownsAttachment = false;
    this.owner = this.devToolsOpen ? "devtools" : "none";
    for (const listener of [...this.interruptions]) listener();
  }

  get currentOwner(): CdpOwner {
    return this.owner;
  }
  get attached(): boolean {
    return !this.contents.isDestroyed() && this.contents.debugger.isAttached();
  }

  async withSession<T>(
    owner: "automation" | "emulation" | "recording",
    fn: (debuggerApi: Debugger) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const assertAvailable = () => {
        if (this.contents.isDestroyed()) throw new Error("CDP interrupted: page was destroyed.");
        if (this.devToolsOpen) throw new Error("CDP interrupted: close DevTools and retry.");
        if (generation !== this.generation)
          throw new Error("CDP interrupted: debugger connection changed.");
      };
      assertAvailable();
      const dbg = this.contents.debugger;
      if (!this.ownsAttachment) {
        if (dbg.isAttached()) throw new Error("CDP debugger is owned by another client.");
        dbg.attach("1.3");
        this.ownsAttachment = true;
      }
      this.owner = owner;
      // Guard every command, including commands following a long await in a caller.
      const expire = () => this.detach();
      const guarded = new Proxy(dbg, {
        get(target, property) {
          if (property === "sendCommand")
            return async (...args: Parameters<Debugger["sendCommand"]>) => {
              assertAvailable();
              let timer: ReturnType<typeof setTimeout> | undefined;
              const result = await Promise.race([
                target.sendCommand(...args),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {
                    expire();
                    reject(new Error("CDP interrupted: command timed out."));
                  }, 10000);
                }),
              ]).finally(() => {
                if (timer) clearTimeout(timer);
              });
              assertAvailable();
              return result;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await fn(guarded);
      assertAvailable();
      return result;
    } finally {
      this.owner = this.devToolsOpen ? "devtools" : "none";
      release();
    }
  }

  detach(): void {
    if (
      this.ownsAttachment &&
      !this.contents.isDestroyed() &&
      this.contents.debugger.isAttached()
    ) {
      this.contents.debugger.detach();
    }
    // Some hosts do not emit detach synchronously, so invalidate pending work explicitly.
    this.handleDetach();
  }
}
