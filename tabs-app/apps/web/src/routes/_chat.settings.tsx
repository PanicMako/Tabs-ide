import { createFileRoute } from "@tanstack/react-router";
import { SettingsScreen } from "~/components/settings/SettingsScreen";

export {
  SettingsSection,
  SettingsRow,
  SettingResetButton,
  SettingsHeaderPortal,
  SettingsSectionHeader,
} from "~/components/settings/SettingsLayout";

export type { SettingsSectionId } from "~/components/settings/SettingsScreen";

/** Deep links into Settings. Opened from the workspace, Settings is a layer instead. */
function SettingsRouteView() {
  return <SettingsScreen />;
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
