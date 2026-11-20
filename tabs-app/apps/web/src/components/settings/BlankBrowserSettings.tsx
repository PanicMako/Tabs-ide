import { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { SegmentedControl } from "../ui/segmented-control";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import type { BlankBrowserPreferences } from "../quick-actions/actions";

const START_PAGES = [
  { value: "", label: "Blank" },
  { value: "https://www.google.com", label: "Google" },
  { value: "https://duckduckgo.com", label: "DuckDuckGo" },
] as const;

type StartChoice = "blank" | "google" | "duckduckgo" | "custom";

function choiceFor(startUrl: string): StartChoice {
  const value = startUrl.trim();
  if (!value) return "blank";
  if (value === START_PAGES[1].value) return "google";
  if (value === START_PAGES[2].value) return "duckduckgo";
  return "custom";
}

/** What Quick Actions' "Blank browser" opens, in one place rather than inside its sub-actions. */
export function BlankBrowserSettings(props: {
  readonly value: BlankBrowserPreferences;
  readonly onChange: (value: BlankBrowserPreferences) => void;
}) {
  const { value, onChange } = props;
  const [choice, setChoice] = useState<StartChoice>(() => choiceFor(value.startUrl));
  const [customUrl, setCustomUrl] = useState(choice === "custom" ? value.startUrl : "");
  useEffect(() => {
    const next = choiceFor(value.startUrl);
    if (next !== "custom" || choice !== "custom") setChoice(next);
    if (next === "custom") setCustomUrl(value.startUrl);
    // Only follow saved changes; a half-typed custom URL stays as typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.startUrl]);

  const pick = (next: StartChoice) => {
    setChoice(next);
    if (next === "blank") onChange({ ...value, startUrl: "" });
    else if (next === "google") onChange({ ...value, startUrl: START_PAGES[1].value });
    else if (next === "duckduckgo") onChange({ ...value, startUrl: START_PAGES[2].value });
    else if (customUrl.trim()) onChange({ ...value, startUrl: customUrl.trim() });
  };

  return (
    <SettingsSection
      title="Blank browser"
      description="What a new blank browser opens with, from Quick Actions or the Browser menu."
    >
      <SettingsRow
        title="Start page"
        description="The page a blank browser opens on. Blank keeps it empty, ready for an address."
        control={
          <SegmentedControl<StartChoice>
            value={choice}
            onValueChange={pick}
            aria-label="Blank browser start page"
            options={[
              { value: "blank", label: "Blank" },
              { value: "google", label: "Google" },
              { value: "duckduckgo", label: "DuckDuckGo" },
              { value: "custom", label: "Custom" },
            ]}
          />
        }
      >
        {choice === "custom" ? (
          <div className="mt-3">
            <Input
              aria-label="Custom start page"
              placeholder="example.com or https://…"
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              onBlur={() => {
                if (customUrl.trim()) onChange({ ...value, startUrl: customUrl.trim() });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && customUrl.trim())
                  onChange({ ...value, startUrl: customUrl.trim() });
              }}
            />
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Keep browser controls open"
        description="A blank page always shows its address bar, back, forward and reload, so you can start typing."
        control={
          <Switch
            aria-label="Keep browser controls open on a blank page"
            checked={value.keepControlsOpen}
            onCheckedChange={(keepControlsOpen) => onChange({ ...value, keepControlsOpen })}
          />
        }
      />
    </SettingsSection>
  );
}
