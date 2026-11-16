import type { SVGProps } from "react";
import { GithubIcon } from "lucide-react";

export function GitCompanionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <GithubIcon aria-hidden="true" {...props}>
      <g className="tool-assistant-gaze" fill="currentColor" stroke="none">
        <ellipse className="tool-assistant-eye" cx="9" cy="9" rx="0.8" ry="1.2" />
        <ellipse className="tool-assistant-eye" cx="15" cy="9" rx="0.8" ry="1.2" />
      </g>
    </GithubIcon>
  );
}

export function WorkspaceBrowserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <ellipse className="tool-globe-meridian" cx="12" cy="12" rx="4" ry="9" />
    </svg>
  );
}

export function WorkspaceTerminalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m7 8 4 4-4 4" />
      <path className="tool-terminal-cursor" d="M14 16h3" />
    </svg>
  );
}

/** A crafted wallpaper roll mark for workspace look and appearance actions. */
export function WorkspaceWallpaperIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? "1.7"}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Hanging wallpaper sheet */}
      <path d="M4 13.5V2.5h16.5v19H4v-4" />
      {/* Chevron wallpaper pattern */}
      <path d="M4 5.5l4.1 2.5 4.1-2.5 4.1 2.5 4.2-2.5" />
      <path d="M4 9.5l4.1 2.5 4.1-2.5 4.1 2.5 4.2-2.5" />
      {/* Rolled wallpaper cylinder with rounded left cap */}
      <path d="M17 13.5H4a2 2 0 0 0 0 4h13" />
      {/* Roll spiral cross-section */}
      <circle cx="17" cy="15.5" r="2" />
      <path d="M15.2 15.5h1.8a.9.9 0 1 1-.9.9" />
    </svg>
  );
}

export const WallpaperRollIcon = WorkspaceWallpaperIcon;
