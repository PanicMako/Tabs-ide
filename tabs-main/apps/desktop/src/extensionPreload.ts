import { contextBridge, ipcRenderer } from "electron";

const CHANNEL = "desktop:extension:storage";
const WORKSPACE_READ_CHANNEL = "desktop:extension:workspace-read";
const GIT_STATUS_CHANNEL = "desktop:extension:git-status";
const NETWORK_GET_CHANNEL = "desktop:extension:network-get";
const LOGIC_INVOKE_CHANNEL = "desktop:extension:logic-invoke";

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
  git: {
    status: (): Promise<{ branch: string; dirty: boolean }> =>
      ipcRenderer.invoke(GIT_STATUS_CHANNEL),
  },
  network: {
    getText: (url: string, options?: { useProfileCredential?: boolean }): Promise<string> =>
      ipcRenderer.invoke(NETWORK_GET_CHANNEL, url, options?.useProfileCredential === true),
  },
  logic: {
    invoke: (commandId: string, input: unknown): Promise<unknown> =>
      ipcRenderer.invoke(LOGIC_INVOKE_CHANNEL, commandId, input),
  },
});
