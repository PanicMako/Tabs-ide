import "../../index.css";
import "../../localFonts.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DocumentationSettings } from "./DocumentationSettings";
import { SourceControlSettingsPanel } from "./SourceControlSettings";
import { SettingsPageTitle, SettingsSectionHeader } from "./SettingsLayout";
import { DEFAULT_FONT_PREFERENCES } from "../../lib/themes";
import { useTheme, snapshotThemeState, restoreThemeSnapshot } from "../../hooks/useTheme";

let discovery = { isLoading: true, error: null as Error | null };
vi.mock("../../lib/sourceControlReactQuery", () => ({
  useSourceControlDiscovery: () => ({
    ...discovery,
    data: undefined,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));
vi.mock("../../state/scopedStateStore", () => ({
  useSettingsViewState: () => [{}, vi.fn()],
}));

function FontSwitch({ font }: { font: string }) {
  const { setFontPreferences } = useTheme();
  return (
    <button
      onClick={() =>
        setFontPreferences({
          ...DEFAULT_FONT_PREFERENCES,
          headingFont: font,
          sectionFont: "'Newsreader', serif",
        })
      }
    >
      Apply test font
    </button>
  );
}

it("keeps standalone page titles aligned with shared headers across loading/error states and font changes", async () => {
  const theme = snapshotThemeState();
  const stored = localStorage.getItem("tabs:font-preferences");
  try {
    for (const [font, size] of [
      ["'Hebdomadal', sans-serif", "40px"],
      ["'Culont', sans-serif", "40px"],
      ["'KS Bistra', sans-serif", "40px"],
      ["'Exotica', sans-serif", "40px"],
      ["'Mirano', sans-serif", "40px"],
      ["'Darker Grotesque', sans-serif", "40px"],
      ["'ZT Otez', serif", "28px"],
    ]) {
      for (const state of [
        { isLoading: true, error: null },
        { isLoading: false, error: new Error("Unavailable") },
        { isLoading: false, error: null },
      ]) {
        discovery = state;
        const view = await render(
          <>
            <FontSwitch font={font!} />
            <SettingsSectionHeader title="Themes" description="Theme settings" />
            <SettingsPageTitle>Providers</SettingsPageTitle>
            <SettingsPageTitle>Diagnostics</SettingsPageTitle>
            <SettingsPageTitle>Connections</SettingsPageTitle>
            <SettingsPageTitle>Keybindings</SettingsPageTitle>
            <DocumentationSettings />
            <SourceControlSettingsPanel startProviderAction={vi.fn()} providerActionBusy={false} />
          </>,
        );
        try {
          await page.getByRole("button", { name: "Apply test font" }).click();
          const titles = view.container.querySelectorAll<HTMLElement>(
            '[data-slot="settings-page-title"]',
          );
          expect(titles.length).toBe(7);
          for (const title of titles) {
            expect(getComputedStyle(title).fontSize).toBe(size);
            expect(getComputedStyle(title).fontFamily).toContain(
              font!.split(",")[0]!.replaceAll("'", ""),
            );
          }
          const section = Array.from(view.container.querySelectorAll("h2, h3")).find(
            (title) => title.textContent === "Version Control",
          );
          if (section) expect(getComputedStyle(section).fontFamily).toContain("Newsreader");
        } finally {
          await view.unmount();
        }
      }
    }
  } finally {
    if (stored === null) localStorage.removeItem("tabs:font-preferences");
    else localStorage.setItem("tabs:font-preferences", stored);
    restoreThemeSnapshot(theme);
  }
});
