import type { ProjectWorkspaceSettings } from "@tabs/contracts/settings";

export function removeBrowserProfileAssignments(
  settings: ProjectWorkspaceSettings,
  profileId: string,
): ProjectWorkspaceSettings {
  const browserUsesProfile =
    settings.browser.partitionMode === "profile" && settings.browser.partitionProfile === profileId;
  const { partitionProfile: _browserProfile, ...browserWithoutProfile } = settings.browser;

  return {
    ...settings,
    browser: browserUsesProfile
      ? { ...browserWithoutProfile, partitionMode: "shared" }
      : settings.browser,
    customEmbeds: settings.customEmbeds.map((embed) => {
      if (embed.partitionMode !== "profile" || embed.partitionProfile !== profileId) {
        return embed;
      }
      const { partitionProfile: _embedProfile, ...embedWithoutProfile } = embed;
      return { ...embedWithoutProfile, partitionMode: "shared" };
    }),
  };
}
