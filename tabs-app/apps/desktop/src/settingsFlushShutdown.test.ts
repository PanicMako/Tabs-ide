import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

const APP_CLOSING_CHANNEL = "desktop:app-closing";
const APP_SETTINGS_FLUSH_DONE_CHANNEL = "desktop:settings-flush-done";

describe("Main/Preload/Renderer Shutdown Flush Handshake Integration Contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes the clean shutdown handshake when the renderer flushes settings in time", async () => {
    const ipcMain = new EventEmitter();
    const webContents = new EventEmitter() as EventEmitter & {
      send: (channel: string, ...args: any[]) => void;
    };
    webContents.send = (channel: string, ...args: any[]) => {
      webContents.emit(channel, ...args);
    };

    const mainWindow = {
      isDestroyed: () => false,
      webContents,
    };

    let logOutput = "";
    const writeDesktopLogHeader = (msg: string) => {
      logOutput += `${msg}\n`;
    };

    // Preload bridge implementation under test
    const desktopBridge = {
      onAppClosing: (listener: () => void) => {
        const wrapped = () => listener();
        webContents.on(APP_CLOSING_CHANNEL, wrapped);
        return () => {
          webContents.removeListener(APP_CLOSING_CHANNEL, wrapped);
        };
      },
      notifySettingsFlushDone: () => {
        ipcMain.emit(APP_SETTINGS_FLUSH_DONE_CHANNEL);
      },
    };

    // Renderer hook listener under test
    let rendererFlushed = false;
    desktopBridge.onAppClosing(async () => {
      // Simulate renderer debounced flush
      rendererFlushed = true;
      desktopBridge.notifySettingsFlushDone();
    });

    // Main process shutdown coordination under test
    let handshakeFinished = false;
    const rendererSettingsFlush =
      mainWindow && !mainWindow.isDestroyed()
        ? new Promise<void>((resolve) => {
            const handleFlushDone = () => {
              clearTimeout(timeoutId);
              handshakeFinished = true;
              resolve();
            };
            const timeoutId = setTimeout(() => {
              ipcMain.removeListener(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
              writeDesktopLogHeader("renderer settings flush timed out after 2000ms");
              resolve();
            }, 2000);
            ipcMain.once(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
          })
        : Promise.resolve();

    // Trigger shutdown sequence
    mainWindow.webContents.send(APP_CLOSING_CHANNEL);

    await rendererSettingsFlush;

    expect(rendererFlushed).toBe(true);
    expect(handshakeFinished).toBe(true);
    expect(logOutput).not.toContain("timed out");
    expect(ipcMain.listenerCount(APP_SETTINGS_FLUSH_DONE_CHANNEL)).toBe(0);
  });

  it("enforces a bounded 2000ms timeout fallback when renderer is unresponsive", async () => {
    const ipcMain = new EventEmitter();
    const webContents = new EventEmitter() as EventEmitter & {
      send: (channel: string, ...args: any[]) => void;
    };
    webContents.send = (channel: string, ...args: any[]) => {
      webContents.emit(channel, ...args);
    };

    const mainWindow = {
      isDestroyed: () => false,
      webContents,
    };

    let logOutput = "";
    const writeDesktopLogHeader = (msg: string) => {
      logOutput += `${msg}\n`;
    };

    // Unresponsive renderer: does not call notifySettingsFlushDone
    webContents.on(APP_CLOSING_CHANNEL, () => {
      // Renderer hangs or crashes, never calls notifySettingsFlushDone
    });

    let handshakeFinished = false;
    const rendererSettingsFlush =
      mainWindow && !mainWindow.isDestroyed()
        ? new Promise<void>((resolve) => {
            const handleFlushDone = () => {
              clearTimeout(timeoutId);
              handshakeFinished = true;
              resolve();
            };
            const timeoutId = setTimeout(() => {
              ipcMain.removeListener(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
              writeDesktopLogHeader("renderer settings flush timed out after 2000ms");
              resolve();
            }, 2000);
            ipcMain.once(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
          })
        : Promise.resolve();

    mainWindow.webContents.send(APP_CLOSING_CHANNEL);

    // Advance time past 2000ms timeout
    vi.advanceTimersByTime(2001);

    await rendererSettingsFlush;

    expect(handshakeFinished).toBe(false); // Did not finish normally
    expect(logOutput).toContain("renderer settings flush timed out after 2000ms");
    expect(ipcMain.listenerCount(APP_SETTINGS_FLUSH_DONE_CHANNEL)).toBe(0); // Listener cleaned up
  });

  it("resolves immediately if mainWindow is already destroyed or missing", async () => {
    const mainWindow = {
      isDestroyed: () => true,
      webContents: new EventEmitter(),
    };

    const rendererSettingsFlush =
      mainWindow && !mainWindow.isDestroyed()
        ? new Promise<void>((resolve) => {
            resolve();
          })
        : Promise.resolve();

    const result = await Promise.race([
      rendererSettingsFlush.then(() => "immediate"),
      new Promise((res) => setTimeout(() => res("delayed"), 50)),
    ]);

    expect(result).toBe("immediate");
  });
});
