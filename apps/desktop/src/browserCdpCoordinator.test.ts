import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BrowserCdpCoordinator } from "./browserCdpCoordinator";

function createMockWebContents() {
  const debuggerEmitter = new EventEmitter();
  let attached = false;

  const mockDebugger = {
    attach: vi.fn((_version?: string) => {
      if (attached) throw new Error("Already attached");
      attached = true;
    }),
    detach: vi.fn(() => {
      if (!attached) throw new Error("Not attached");
      attached = false;
      debuggerEmitter.emit("detach", {}, "User detached");
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    on: debuggerEmitter.on.bind(debuggerEmitter),
    emit: debuggerEmitter.emit.bind(debuggerEmitter),
  };

  return {
    isDestroyed: vi.fn(() => false),
    debugger: mockDebugger,
  };
}

describe("BrowserCdpCoordinator", () => {
  it("retains its connection between scoped operations until explicit release", async () => {
    const webContents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(webContents as any);

    expect(coordinator.attached).toBe(false);

    let capturedInBlock = false;
    const result = await coordinator.withSession("automation", async (dbg) => {
      capturedInBlock = dbg.isAttached();
      return await dbg.sendCommand("Emulation.setDeviceMetricsOverride");
    });

    expect(capturedInBlock).toBe(true);
    expect(result).toEqual({ success: true });
    expect(coordinator.attached).toBe(true);
    coordinator.detach();
    expect(coordinator.attached).toBe(false);
    expect(webContents.debugger.attach).toHaveBeenCalledWith("1.3");
    expect(webContents.debugger.detach).toHaveBeenCalled();
  });

  it("rejects an attachment owned by another client", async () => {
    const webContents = createMockWebContents();
    webContents.debugger.isAttached.mockReturnValue(true);
    const coordinator = new BrowserCdpCoordinator(webContents as any);

    await expect(coordinator.withSession("emulation", async () => undefined)).rejects.toThrow(
      "another client",
    );

    // When wasAttached was true, coordinator does NOT detach at the end
    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(webContents.debugger.detach).not.toHaveBeenCalled();
  });

  it("coordinates with DevTools opening and prevents premature detachment", async () => {
    const webContents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(webContents as any);

    coordinator.handleDevToolsOpened();
    expect(coordinator.currentOwner).toBe("devtools");

    // When DevTools is open, debugger is marked in use by devtools
    coordinator.handleDevToolsClosed();
    expect(coordinator.currentOwner).toBe("none");
  });

  it("handles unexpected detach events safely", () => {
    const webContents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(webContents as any);

    coordinator.handleDetach("Target crashed");
    expect(coordinator.attached).toBe(false);
    expect(coordinator.currentOwner).toBe("none");
  });
});

describe("CDP concurrency", () => {
  it("serializes operations so one cannot detach another's session", async () => {
    const contents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(contents as any);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const first = coordinator.withSession("automation", async () => {
      events.push("first");
      await gate;
      events.push("first done");
    });
    const second = coordinator.withSession("emulation", async (dbg) => {
      events.push("second");
      expect(dbg.isAttached()).toBe(true);
    });
    await Promise.resolve();
    expect(events).toEqual(["first"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first", "first done", "second"]);
  });

  it("releases the queue after a failed operation", async () => {
    const contents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(contents as any);
    const first = coordinator.withSession("automation", async () => {
      throw new Error("failed");
    });
    const second = coordinator.withSession("emulation", async () => "next");
    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe("next");
    expect(contents.debugger.attach).toHaveBeenCalledTimes(1);
    expect(contents.debugger.detach).not.toHaveBeenCalled();
  });

  it("does not run commands while DevTools owns the debugger", async () => {
    const contents = createMockWebContents();
    const coordinator = new BrowserCdpCoordinator(contents as any);
    coordinator.handleDevToolsOpened();
    const command = vi.fn();
    await expect(coordinator.withSession("automation", command)).rejects.toThrow("DevTools");
    expect(command).not.toHaveBeenCalled();
    expect(contents.debugger.attach).not.toHaveBeenCalled();
  });
});

it("invalidates running and queued commands when DevTools preempts the connection", async () => {
  const contents = createMockWebContents();
  const coordinator = new BrowserCdpCoordinator(contents as any);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = coordinator.withSession("automation", async (debug) => {
    await gate;
    await debug.sendCommand("Runtime.evaluate");
  });
  await Promise.resolve();
  const second = coordinator.withSession("automation", async (debug) =>
    debug.sendCommand("Runtime.evaluate"),
  );
  coordinator.prepareForDevTools();
  coordinator.handleDevToolsClosed();
  release();
  await expect(first).rejects.toThrow("interrupted");
  await expect(second).rejects.toThrow("interrupted");
  expect(contents.debugger.sendCommand).not.toHaveBeenCalled();
});
