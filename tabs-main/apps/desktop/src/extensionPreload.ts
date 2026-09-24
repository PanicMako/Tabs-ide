import { contextBridge, ipcRenderer } from "electron";

const CHANNEL = "desktop:extension:storage";

/** Deliberately no identity argument: main binds every call to the active WebContents. */
contextBridge.exposeInMainWorld("tabsExtension", {
  storage: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke(CHANNEL, { kind: "get", key }),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(CHANNEL, { kind: "set", key, value }),
    delete: (key: string): Promise<void> => ipcRenderer.invoke(CHANNEL, { kind: "delete", key }),
  },
});
