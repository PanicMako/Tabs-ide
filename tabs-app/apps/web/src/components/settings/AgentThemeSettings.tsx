import { ArrowLeftIcon } from "lucide-react";

import { Button } from "../ui/button";
import { SettingsSectionHeader } from "./SettingsLayout";
import { UserThemeSettings } from "./UserThemeSettings";

/** Labs page for the colors and CSS an agent (or you) layers on top of the active theme. */
export default function AgentThemeSettings({ onBack }: { onBack?: () => void } = {}) {
  return (
    <div className="space-y-8">
      <SettingsSectionHeader
        title="Agent theme"
        description="Ask an agent to restyle Tabs, or tune the colors and CSS yourself."
        preTitle={
          onBack ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to Labs"
              className="size-8 shrink-0 rounded-full"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : undefined
        }
      />
      <UserThemeSettings />
    </div>
  );
}
