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
