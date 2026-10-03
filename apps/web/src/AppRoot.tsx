import { useState, useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";

import { AppAtomRegistryProvider } from "./state/atomRegistry";
import { useAppClosing } from "./hooks/useAppClosing";
import { useClientSettings } from "./state/settings";
import { useTheme } from "./hooks/useTheme";
import { CloseScreen } from "./components/CloseScreen";
import {
  QuitConfirmationModal,
  type QuitConfirmationChoice,
} from "./components/QuitConfirmationModal";
import type { ClosePhase } from "./components/CloseScreen";
import type { AppRouter } from "./router";

function CloseScreenOverlay({ cleanupDone }: { cleanupDone: boolean }) {
  const [phase, setPhase] = useState<ClosePhase>("idle");
  const clientSettings = useClientSettings();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (cleanupDone) {
      setPhase("closing");
    }
  }, [cleanupDone]);

  const closeStyle = clientSettings.closeLoaderStyle;
  const closePalette = clientSettings.closeLoaderPalette;
  const closeTheme = clientSettings.closeLoaderTheme;

  const effectiveTheme = closeTheme !== "system" ? closeTheme : resolvedTheme;

  return (
    <div className="fixed inset-0 z-[9999]">
      <CloseScreen
        loader={closeStyle}
        palette={closePalette}
        theme={effectiveTheme}
        phase={phase}
        onIntroEnd={() => {
          window.desktopBridge?.notifyReadyToExit?.();
        }}
      />
    </div>
  );
}

export function AppRoot({ router }: { readonly router: AppRouter }) {
  const { isClosing, cleanupDone } = useAppClosing();
  const [isQuitConfirmationOpen, setIsQuitConfirmationOpen] = useState(false);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onQuitConfirmationRequested) return;
    return bridge.onQuitConfirmationRequested(() => setIsQuitConfirmationOpen(true));
  }, []);

  const respondToQuitConfirmation = (choice: QuitConfirmationChoice) => {
    setIsQuitConfirmationOpen(false);
    window.desktopBridge?.respondToQuitConfirmation?.(choice);
  };

  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <QuitConfirmationModal open={isQuitConfirmationOpen} onChoice={respondToQuitConfirmation} />
      {isClosing && <CloseScreenOverlay cleanupDone={cleanupDone} />}
    </AppAtomRegistryProvider>
  );
}
