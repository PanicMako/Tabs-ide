import { ArrowLeftIcon } from "lucide-react";
import { createContext, useContext, type ReactNode, useState } from "react";
import { ScopedPortalContext } from "../../lib/scopedPortal";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import { useTheme } from "../../hooks/useTheme";
import "./settings-editorial.css";

const SettingsStudyAppearanceContext = createContext<"dark" | "light" | null>(null);

export const useSettingsStudyAppearance = () => useContext(SettingsStudyAppearanceContext);

export function SettingsEditorialFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const enabled = useSettingsLabsStore((state) => state.editorialSettings);
  const settingsOnly = useSettingsLabsStore((state) => state.editorialSettingsOnly);
  const storedAppearance = useSettingsLabsStore((state) => state.editorialAppearance);
  const { resolvedTheme } = useTheme();
  const appearance = settingsOnly ? resolvedTheme : storedAppearance;
  return (
    <SettingsStudyAppearanceContext.Provider value={enabled ? appearance : null}>
      <ScopedPortalContext.Provider value={enabled ? (container ?? undefined) : undefined}>
        <div
          ref={setContainer}
          data-settings-design={enabled ? "editorial" : "classic"}
          data-settings-appearance={appearance}
          data-settings-scope={enabled ? (settingsOnly ? "settings" : "workspace") : undefined}
          className={className}
        >
          {children}
        </div>
      </ScopedPortalContext.Provider>
    </SettingsStudyAppearanceContext.Provider>
  );
}

export function SettingsWorkspaceIdentity({
  onBack,
  pageName,
  onSettingsHome,
}: {
  onBack: () => void;
  pageName?: string | undefined;
  onSettingsHome?: () => void;
}) {
  return (
    <>
      <button data-slot="settings-study-back" type="button" className="no-drag" onClick={onBack}>
        <ArrowLeftIcon aria-hidden="true" className="size-3.5" /> Back
      </button>
      <button
        data-slot="settings-wordmark"
        type="button"
        className="no-drag"
        onClick={onBack}
        aria-label="Back to workspace"
      >
        <span>Tabs</span>
        <span data-slot="settings-wordmark-ide">IDE</span>
      </button>
      <nav data-slot="settings-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="no-drag" onClick={onBack}>
          Workspace
        </button>
        <span aria-hidden="true">/</span>
        <button type="button" className="no-drag" onClick={onSettingsHome}>
          Settings
        </button>
        {pageName && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{pageName}</span>
          </>
        )}
      </nav>
      <button
        data-slot="settings-workspace-link"
        type="button"
        className="no-drag"
        onClick={onBack}
      >
        Personal workspace <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}
