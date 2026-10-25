import { useCallback, useEffect } from "react";
import type { AiProvider } from "@tabs/contracts";
import { CODE_CHROME_COMMANDS } from "@tabs/shared/codeChrome";

/** Keep the toolbar's two chat providers mutually exclusive across settings changes. */
export function useCodeAssistantPanels(options: {
  provider: AiProvider;
  hostReady: boolean;
  sideChatOpen: boolean;
  setSideChatOpen: (open: boolean) => void;
  runCommand: (command: string) => void;
}) {
  const { provider, hostReady, sideChatOpen, setSideChatOpen, runCommand } = options;
  useEffect(() => {
    if (provider === "copilot") {
      setSideChatOpen(false);
    } else if (hostReady) {
      runCommand(CODE_CHROME_COMMANDS.closeAuxiliaryBar);
    }
  }, [provider, hostReady, setSideChatOpen, runCommand]);

  return useCallback(() => {
    if (provider === "copilot") {
      setSideChatOpen(false);
      runCommand(CODE_CHROME_COMMANDS.toggleAuxiliaryBar);
    } else {
      // A native extension may have reopened the sidebar since the preference
      // changed. Close it again before revealing Tabs' own chat surface.
      runCommand(CODE_CHROME_COMMANDS.closeAuxiliaryBar);
      setSideChatOpen(!sideChatOpen);
    }
  }, [provider, sideChatOpen, setSideChatOpen, runCommand]);
}
