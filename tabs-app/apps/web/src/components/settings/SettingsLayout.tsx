import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { getActiveFontCombo, getFontComboPageHeading } from "../../lib/themes";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import { interfaceStudyAccent } from "../../lib/interfaceStudy";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SettingsHeaderPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    setTarget(document.getElementById("settings-header-actions"));
  }, []);
  if (!target) return null;
  return createPortal(children, target);
}

export function SettingsSection({
  title,
  description,
  headerAction,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);

  return (
    <section
      data-slot="settings-section"
      style={interfaceStudyAccent(title)}
      className={cn(
        "space-y-3",
        activeFontCombo.isNeutral && activeFontCombo.id !== "custom" ? "pt-2" : "pt-0 -mt-2",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {activeFontCombo.isNeutral && activeFontCombo.id !== "custom" ? (
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </h3>
          ) : (
            <h2
              className={cn(
                "text-[18px] leading-relaxed text-foreground/80",
                activeFontCombo.serifClass,
              )}
              style={{
                fontFamily: "var(--font-section, var(--font-display))",
                fontWeight: "var(--font-section-weight)" as React.CSSProperties["fontWeight"],
                fontStyle: "var(--font-section-style)" as React.CSSProperties["fontStyle"],
                textTransform:
                  "var(--font-section-transform)" as React.CSSProperties["textTransform"],
                letterSpacing: "var(--font-section-tracking)",
              }}
            >
              {title}
            </h2>
          )}
          {description ? (
            <div
              className="mt-1 text-xs text-muted-foreground leading-normal"
              style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
            >
              {description}
            </div>
          ) : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div
        data-slot="settings-section-panel"
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5"
      data-slot="settings-row"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3
              className="text-[14.5px] font-bold text-foreground flex items-center gap-2"
              style={{
                fontFamily: "var(--font-row, var(--font-sans))",
                fontWeight: "var(--font-row-weight)" as React.CSSProperties["fontWeight"],
              }}
            >
              {title}
            </h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <span className="sr-only">Reset {label}</span>
            <svg
              className="size-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsSectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  const editorial = useSettingsLabsStore((state) => state.editorialSettings);
  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);
  const pageHeading = useMemo(
    () => getFontComboPageHeading(activeFontCombo, fontPreferences),
    [activeFontCombo, fontPreferences],
  );

  return (
    <div data-slot="settings-page-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2
            data-slot="settings-page-title"
            className={cn(
              "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
              pageHeading.className,
            )}
            style={{
              fontFamily: pageHeading.fontFamily,
              fontWeight: pageHeading.fontWeight,
              letterSpacing: pageHeading.letterSpacing,
              textTransform: pageHeading.textTransform,
            }}
          >
            {title}
          </h2>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <p
        className="w-full mt-1.5 text-sm leading-relaxed text-muted-foreground"
        style={{
          fontFamily: "var(--font-supporting, var(--font-sans))",
          fontStyle: "var(--font-supporting-style)" as React.CSSProperties["fontStyle"],
        }}
      >
        {editorial ? (SETTINGS_PAGE_SUMMARIES[title] ?? description) : description}
      </p>
      <div
        data-slot="settings-divider"
        className="h-[5px] w-full my-5 rounded-full dark:block hidden"
        style={{
          background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)",
        }}
      />
      <div
        data-slot="settings-divider"
        className="h-[5px] w-full my-5 rounded-full dark:hidden block"
        style={{
          background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)",
        }}
      />
    </div>
  );
}

const SETTINGS_PAGE_SUMMARIES: Record<string, string> = {
  General: "Make Tabs work your way.",
  Notifications: "Choose what reaches you.",
  Themes: "Your colors, type, and finishing touches.",
  Animations: "Set the pace of your workspace.",
  Providers: "Connect your agents and models.",
  "Usage & Limits": "Track usage and provider availability.",
  Diagnostics: "Inspect performance and troubleshoot.",
  Documentation: "Find guides and references.",
  "Source Control": "Configure your Git workflow.",
  Connections: "Manage connected services.",
  Workspace: "Tune your projects and workspace.",
  "Browser Profiles": "Keep browsing contexts separate.",
  Keybindings: "Make shortcuts your own.",
  About: "Build details and updates.",
  Labs: "Try what comes next.",
};
