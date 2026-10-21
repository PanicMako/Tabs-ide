export interface NativeAgentCoordinator {
  initialize(legacyCount: number): unknown;
  update(windowId: number | undefined, update: unknown): void;
  claim(windowId: number, resource: unknown, developerMode: boolean): unknown;
  markShown(windowId: number, id: string): void;
  release(windowId: number, id: string): void;
  resetWindow(windowId: number, retainActivity: boolean): void;
  onDidChange(listener: (state: unknown) => void): { dispose(): void };
  dispose(): void;
}

/** Adapts registered embedded renderers to the upstream coordinator's window ownership. */
export function createNativeCodeHostActivity(
  coordinator: NativeAgentCoordinator,
  revive: (value: unknown) => unknown,
  windowKind: (id: number) => "editor" | "agents" | undefined,
) {
  const editor = (id: number | undefined) => {
    if (id === undefined || windowKind(id) !== "editor") {
      throw new Error("Agent activity requires a registered editor window");
    }
    return id;
  };
  return {
    initialize(count: unknown) {
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("Invalid legacy agent session count");
      }
      return coordinator.initialize(count);
    },
    update(id: number | undefined, value: unknown) {
      if (!value || typeof value !== "object" || !("kind" in value)) {
        throw new Error("Invalid agent activity update");
      }
      if (id !== undefined && windowKind(id) === "agents" && value.kind === "request") {
        coordinator.update(undefined, value);
      } else {
        coordinator.update(editor(id), value);
      }
    },
    claim(id: number | undefined, resource: unknown, developerMode: unknown) {
      return coordinator.claim(editor(id), revive(resource), developerMode === true);
    },
    markShown(id: number | undefined, invitation: string) {
      coordinator.markShown(editor(id), invitation);
    },
    release(id: number | undefined, invitation: string) {
      coordinator.release(editor(id), invitation);
    },
  };
}
