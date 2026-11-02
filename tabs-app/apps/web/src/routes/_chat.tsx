import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkspaceShell } from "../components/WorkspaceShell";
import { SidebarProvider } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { isPopoutMode, isConversationPopout } from "../lib/utils";

function ChatRouteLayout() {
  if (isPopoutMode()) {
    return (
      <SidebarProvider defaultOpen={false}>
        <div className="flex h-dvh w-full min-h-0 min-w-0 flex-1 flex-col bg-background">
          {isConversationPopout && (
            <div className="drag-region flex h-12 shrink-0 items-center justify-end border-b px-4">
              <button
                className="no-drag rounded px-3 py-1 text-sm hover:bg-accent focus-visible:outline"
                onClick={() => {
                  const route = window.location.hash
                    ? window.location.hash.slice(1)
                    : window.location.pathname;
                  void window.desktopBridge
                    ?.dockConversation?.(route.split("?")[0]!)
                    .catch((error: unknown) => {
                      toastManager.add({
                        type: "error",
                        title: "Could not dock conversation",
                        description: String(error),
                      });
                    });
                }}
              >
                Dock conversation
              </button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <WorkspaceShell agentsContent={<Outlet />} settingsContent={<Outlet />} />
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
