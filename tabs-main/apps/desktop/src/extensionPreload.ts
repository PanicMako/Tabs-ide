import { contextBridge, ipcRenderer } from "electron";

const CHANNEL = "desktop:extension:storage";
const WORKSPACE_READ_CHANNEL = "desktop:extension:workspace-read";
const NETWORK_GET_CHANNEL = "desktop:extension:network-get";

/** Deliberately no identity argument: main binds every call to the active WebContents. */
contextBridge.exposeInMainWorld("tabsExtension", {
  storage: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke(CHANNEL, { kind: "get", key }),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(CHANNEL, { kind: "set", key, value }),
    delete: (key: string): Promise<void> => ipcRenderer.invoke(CHANNEL, { kind: "delete", key }),
  },
  workspace: {
    readText: (relativePath: string): Promise<string> =>
      ipcRenderer.invoke(WORKSPACE_READ_CHANNEL, relativePath),
  },
  network: {
    getText: (url: string): Promise<string> => ipcRenderer.invoke(NETWORK_GET_CHANNEL, url),
  },
});
