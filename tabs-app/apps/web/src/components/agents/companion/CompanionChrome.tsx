import type { ReactNode, CSSProperties } from "react";
import { surfaces } from "./SurfaceTabs";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import "./companion.css";

export function CompanionHeading({
  kind,
  title,
  detail,
  actions,
}: {
  kind: RightPanelTab;
  title?: string | undefined;
  detail?: string | undefined;
  actions?: ReactNode;
}) {
  const surface = surfaces.find((item) => item.id === kind)!;
  return (
    <header
      className="companion-heading"
      style={{ "--companion-tint": surface.tint } as CSSProperties}
    >
      <span className="companion-heading-icon">
        <surface.Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2>{title ?? surface.label}</h2>
        {detail && <p title={detail}>{detail}</p>}
      </div>
      <div className="companion-heading-actions">{actions}</div>
    </header>
  );
}
export function CompanionEmpty({
  kind,
  title,
  children,
  action,
}: {
  kind: RightPanelTab;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const surface = surfaces.find((item) => item.id === kind)!;
  return (
    <div className="companion-empty" style={{ "--companion-tint": surface.tint } as CSSProperties}>
      <span className="companion-empty-icon">
        <surface.Icon size={25} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
