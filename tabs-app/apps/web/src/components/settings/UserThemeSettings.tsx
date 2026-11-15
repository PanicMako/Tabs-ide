import { XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_USER_THEME,
  USER_THEME_COLOR_ROLES,
  USER_THEME_CSS_MAX_LENGTH,
  type UserTheme,
  type UserThemeColors,
} from "@tabs/contracts";
import { sanitizeUserThemeCss } from "@tabs/shared/themeCss";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { CustomColorPicker } from "../ui/CustomColorPicker";
import { SettingsSection } from "./SettingsLayout";

const sameTheme = (a: UserTheme, b: UserTheme) =>
  JSON.stringify([a.colors, a.light, a.dark, a.css]) ===
  JSON.stringify([b.colors, b.light, b.dark, b.css]);

/** The 6-digit form a color input accepts. */
const toInputHex = (value: string | null | undefined) =>
  value && /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#808080";

type ColorRole = (typeof USER_THEME_COLOR_ROLES)[number];

/** The flat role list is long; grouping it by job makes it scannable. */
const COLOR_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly roles: ReadonlyArray<ColorRole>;
}> = [
  {
    label: "Surfaces",
    roles: ["background", "card", "popover", "secondary", "muted", "sidebar-background"],
  },
  {
    label: "Text",
    roles: [
      "foreground",
      "card-foreground",
      "popover-foreground",
      "secondary-foreground",
      "muted-foreground",
      "sidebar-foreground",
    ],
  },
  {
    label: "Accents",
    roles: [
      "primary",
      "primary-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "destructive-foreground",
    ],
  },
  { label: "Lines and focus", roles: ["border", "input", "ring"] },
];

/** The color a role currently resolves to, as #rrggbb, so the picker opens on what you see. */
function resolveRoleHex(role: ColorRole): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(--${role})`;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return "#808080";
    context.fillStyle = "#808080";
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [r = 128, g = 128, b = 128] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#808080";
  }
}

function ColorChip(props: {
  readonly role: ColorRole;
  readonly value: string | null | undefined;
  readonly onChange: (value: string) => void;
  readonly onClear: () => void;
}) {
  const { role, value, onChange, onClear } = props;
  const fallback = useMemo(() => resolveRoleHex(role), [role]);
  return (
    <div
      className={cn(
        "group/chip flex min-w-0 items-center rounded-[var(--radius-tile)] border transition-colors",
        value
          ? "border-border bg-background/60"
          : "border-dashed border-border/70 bg-transparent hover:border-border",
      )}
    >
      <CustomColorPicker
        label={role}
        description=""
        value={value ?? fallback}
        onChange={onChange}
        trigger={{
          className:
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[var(--radius-tile)] px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          children: (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "size-7 shrink-0 rounded-[var(--radius-tile)] ring-1 ring-inset ring-foreground/15",
                  !value &&
                    "bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--border)_4px_5px)]",
                )}
                style={value ? { backgroundColor: value } : undefined}
              />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12.5px] font-medium text-foreground/90">
                  {role}
                </span>
                <span className="block truncate font-mono text-[10.5px] uppercase text-muted-foreground/70">
                  {value ?? "Theme default"}
                </span>
              </span>
            </>
          ),
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label={`Clear ${role}`}
          title="Back to the theme default"
          className="mr-2 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/chip:opacity-100"
          onClick={onClear}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

/** Review, edit and reset what an agent (or you) changed about how Tabs looks. */
export function UserThemeSettings() {
  const { userTheme } = useSettings();
  const { updateSettings } = useUpdateSettings();
  const saved = userTheme ?? EMPTY_USER_THEME;
  const [draft, setDraft] = useState<UserTheme>(saved);
  const dirty = !sameTheme(draft, saved);

  // An agent changed the theme while this was open: follow it unless there are local edits.
  useEffect(() => {
    setDraft((current) => (sameTheme(current, saved) || !dirty ? saved : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.updatedAt]);

  const cssCheck = useMemo(() => sanitizeUserThemeCss(draft.css), [draft.css]);
  const setColor = (role: (typeof USER_THEME_COLOR_ROLES)[number], value: string | null) =>
    setDraft((current) => {
      const colors: Record<string, string | null> = { ...current.colors };
      if (value === null) delete colors[role];
      else colors[role] = value;
      return { ...current, colors: colors as UserThemeColors };
    });

  const save = () =>
    updateSettings({ userTheme: { ...draft, updatedAt: new Date().toISOString() } });
  const reset = () => {
    setDraft(EMPTY_USER_THEME);
    return updateSettings({
      userTheme: { ...EMPTY_USER_THEME, updatedAt: new Date().toISOString() },
    });
  };
  const isEmpty = sameTheme(saved, EMPTY_USER_THEME);

  const overrideCount = USER_THEME_COLOR_ROLES.filter((role) => draft.colors[role]).length;

  return (
    <SettingsSection
      title="Agent theme"
      description="Colors and CSS an agent set with its theme tool, or you set here. It applies live on top of the active theme."
      headerAction={
        <Button
          size="sm"
          variant="outline"
          disabled={isEmpty && !dirty}
          onClick={() => void reset()}
        >
          Reset to plain theme
        </Button>
      }
    >
      <div data-slot="user-theme-settings">
        <div className="space-y-5 px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[14.5px] font-medium text-foreground">Colors</h4>
            <span className="text-[11px] tabular-nums text-muted-foreground/80">
              {overrideCount === 0 ? "Using the theme's colors" : `${overrideCount} overridden`}
            </span>
          </div>
          {COLOR_GROUPS.map((group) => (
            <div key={group.label} className="space-y-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.label}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.roles.map((role) => (
                  <ColorChip
                    key={role}
                    role={role}
                    value={draft.colors[role]}
                    onChange={(next) => setColor(role, next)}
                    onClear={() => setColor(role, null)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <label className="block space-y-2 border-t border-border px-4 py-4 sm:px-5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[14.5px] font-medium text-foreground">Custom CSS</span>
            <span className="text-[11px] tabular-nums text-muted-foreground/70">
              {draft.css.length.toLocaleString()} / {USER_THEME_CSS_MAX_LENGTH.toLocaleString()}
            </span>
          </span>
          <textarea
            spellCheck={false}
            rows={7}
            maxLength={USER_THEME_CSS_MAX_LENGTH}
            className="w-full resize-y rounded-[var(--radius-tile)] border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft.css}
            onChange={(event) => setDraft((current) => ({ ...current, css: event.target.value }))}
            placeholder={".chat-markdown { line-height: 1.7; }"}
          />
          {cssCheck.ok ? (
            <span className="block text-[11px] leading-relaxed text-muted-foreground/80">
              No @import, no remote url(), no !important. Wallpaper reading plates keep their own
              colors.
            </span>
          ) : (
            <span role="alert" className="block text-[11px] leading-relaxed text-destructive">
              {cssCheck.error}
            </span>
          )}
        </label>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
          <span className="text-[11px] text-muted-foreground/80">
            {dirty ? "Unsaved changes" : "Everything is applied"}
          </span>
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                Discard
              </Button>
            ) : null}
            <Button size="sm" disabled={!dirty || !cssCheck.ok} onClick={() => void save()}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
