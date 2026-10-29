import type { ReactNode } from "react";
import { SettingsNavIcon, type SettingsNavIconKind } from "./SettingsNavIcon";
import "./SettingsNavigation.css";

export type SettingsPageId = SettingsNavIconKind;

export const SETTINGS_NAV_GROUPS = [
  {
    id: "preferences",
    label: "Make it yours",
    items: [
      { id: "general", label: "General" },
      { id: "notifications", label: "Notifications" },
      { id: "themes", label: "Themes" },
      { id: "startup-animation", label: "Animations" },
    ],
  },
  {
    id: "intelligence",
    label: "Agent desk",
    items: [
      { id: "providers", label: "Providers" },
      { id: "agent-plugins", label: "Agent plugins" },
      { id: "usage", label: "Usage & Limits" },
    ],
  },
  {
    id: "workspace",
    label: "Workbench",
    items: [
      { id: "workspace", label: "Workspace" },
      { id: "source-control", label: "Source Control" },
      { id: "connections", label: "Connections" },
      { id: "profiles", label: "Browser Profiles" },
      { id: "keybindings", label: "Keybindings" },
    ],
  },
  {
    id: "support",
    label: "Inside Tabs",
    items: [
      { id: "diagnostics", label: "Diagnostics" },
      { id: "documentation", label: "Documentation" },
      { id: "about", label: "About" },
    ],
  },
  {
    id: "first-look",
    label: "First look",
    items: [{ id: "labs", label: "Labs" }],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  items: ReadonlyArray<{ id: SettingsPageId; label: string }>;
}>;

export const SETTINGS_NAV: ReadonlyArray<{ id: SettingsPageId; label: string }> =
  SETTINGS_NAV_GROUPS.flatMap((group) => [...group.items]);

export function SettingsNavigation({
  activeSection,
  onSelect,
  reducedMotion,
  notificationBadge,
}: {
  activeSection: SettingsPageId;
  onSelect: (section: SettingsPageId) => void;
  reducedMotion: boolean;
  notificationBadge?: ReactNode;
}) {
  return (
    <nav
      data-slot="settings-nav"
      data-settings-icon-motion={reducedMotion ? "off" : "on"}
      aria-label="Settings pages"
      className="settings-navigation"
    >
      {SETTINGS_NAV_GROUPS.map((group) => (
        <div
          key={group.id}
          className="settings-navigation-group"
          role="group"
          aria-labelledby={`settings-nav-${group.id}`}
        >
          <h2 id={`settings-nav-${group.id}`} className="settings-navigation-heading">
            {group.label}
          </h2>
          <ul className="settings-navigation-items">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-settings-nav-item={item.id}
                  aria-current={activeSection === item.id ? "page" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <SettingsNavIcon kind={item.id} className="size-5 shrink-0" />
                  <span className="settings-navigation-label">{item.label}</span>
                  {item.id === "notifications" && activeSection !== item.id
                    ? notificationBadge
                    : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
