import type { SVGProps } from "react";
import "./SettingsNavIcon.css";

export type SettingsNavIconKind =
  | "quick-actions"
  | "maintenance"
  | "general"
  | "notifications"
  | "themes"
  | "startup-animation"
  | "agent-plugins"
  | "providers"
  | "usage"
  | "diagnostics"
  | "documentation"
  | "source-control"
  | "connections"
  | "workspace"
  | "profiles"
  | "keybindings"
  | "about"
  | "labs";

type Props = SVGProps<SVGSVGElement> & { kind: SettingsNavIconKind };

/** Small, theme-aware scenes. Only their internal parts move; navigation targets stay still. */
export function SettingsNavIcon({ kind, className = "", ...props }: Props) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={
        kind === "general" || kind === "profiles" || kind === "source-control" ? 1.8 : 1.1
      }
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`settings-nav-icon ${className}`}
      data-settings-icon={kind}
    >
      {kind === "quick-actions" && (
        <>
          <circle cx="16" cy="16" r="11" />
          <path d="m21 11-3 7-7 3 3-7Z" />
        </>
      )}
      {kind === "maintenance" && (
        <>
          <path d="M5 8h22v16H5zM5 18h22" />
          <circle cx="22" cy="21" r="1" />
        </>
      )}
      {kind === "agent-plugins" && (
        <>
          <path d="M5 9h8V6a3 3 0 0 1 6 0v3h8v8h-3a3 3 0 0 0 0 6h3v5H5V9Z" />
          <path d="M9 14h5m-2.5-2.5v5" />
        </>
      )}
      {kind === "general" && (
        <>
          <circle cx="16" cy="16" r="12.5" />
          <path d="M16 5.5V8M26.5 16H24M16 26.5V24M5.5 16H8" opacity=".5" />
          <g className="sni-compass-needle">
            <path d="m22 10-3.5 8.5L10 22l3.5-8.5Z" fill="currentColor" fillOpacity=".18" />
            <path d="m22 10-3.5 8.5-5-5Z" fill="currentColor" stroke="none" />
          </g>
          <circle cx="16" cy="16" r="1" fill="var(--background)" strokeWidth="1" />
        </>
      )}
      {kind === "connections" && (
        <>
          <path
            className="sni-link-first"
            d="m17.7 10.1 3-3a5.1 5.1 0 0 1 7.2 7.2l-5.5 5.5a5.1 5.1 0 0 1-7.2 0"
            strokeWidth="1.1"
          />
          <path
            className="sni-link-second"
            d="m14.3 21.9-3 3a5.1 5.1 0 0 1-7.2-7.2l5.5-5.5a5.1 5.1 0 0 1 7.2 0"
            strokeWidth="1.1"
          />
          <path className="sni-link-bridge" d="m12.2 19.8 7.6-7.6" strokeWidth="1.1" />
        </>
      )}
      {kind === "workspace" && (
        <>
          <path d="M3 28h26M4 27a5 5 0 0 1 10 0M8 22 4.5 14l7-7" />
          <circle cx="4.5" cy="14" r="1.6" fill="currentColor" stroke="none" />
          <g className="sni-lamp">
            <path
              d="m10 7 4-4 4 4c2-.3 3 .1 4 1l-9 9c-1-1-1.3-2.4-1-4L8 9z"
              fill="currentColor"
              fillOpacity=".05"
            />
            <path className="sni-lamp-light" d="m17 16 1 3m4-7 3 1m-4 2 2 2" />
          </g>
          <path d="M19 16h7v8h-7zM26 17h1a2 2 0 0 1 0 4h-1M16 24h12v4H16a2 2 0 0 1 0-4Z" />
        </>
      )}
      {kind === "profiles" && (
        <>
          <g className="sni-profile-first">
            <circle cx="10" cy="10.5" r="5" fill="currentColor" fillOpacity=".16" />
            <path d="M2.5 27v-3a7.5 7.5 0 0 1 15 0v3Z" fill="currentColor" fillOpacity=".16" />
          </g>
          <g className="sni-profile-second">
            <circle cx="23" cy="11.5" r="4.5" />
            <path d="M20 18a7 7 0 0 1 9.5 6.5V27H21" />
          </g>
        </>
      )}
      {kind === "about" && (
        <>
          <circle cx="16" cy="16" r="12" />
          <path d="M16 14v7m-2 0h4" />
          <circle cx="16" cy="10" r="0.8" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "labs" && (
        <>
          <path d="M11 4h10M13 4v10L5.5 25a2.2 2.2 0 0 0 1.8 3.5h17.4a2.2 2.2 0 0 0 1.8-3.5L19 14V4" />
          <path
            className="sni-liquid"
            d="M10 19c4 3 8-3 12 0l4 7H6Z"
            fill="currentColor"
            fillOpacity=".1"
            stroke="none"
          />
          <circle
            className="sni-bubble-first"
            cx="13"
            cy="24"
            r="1"
            fill="currentColor"
            stroke="none"
          />
          <circle
            className="sni-bubble-second"
            cx="19"
            cy="22"
            r="1.3"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
      {kind === "diagnostics" && (
        <>
          <path d="M23 5H5v18h17M3 27h26l-3-4M3 27l2-4" />
          <path className="sni-heartbeat" d="M8 14h3l2-5 3 10 2-5h3" />
          <g className="sni-magnifier">
            <circle cx="25" cy="13" r="4.5" fill="var(--background)" />
            <path d="m27.5 17 3 4M23 12a2 2 0 0 1 2-1" />
          </g>
        </>
      )}
      {kind === "startup-animation" && (
        <>
          <rect x="3" y="5" width="26" height="22" rx="2" />
          <path d="M3 10h26M3 23h26" />
          <path
            className="sni-film"
            d="M7 7.5h1m5 0h1m5 0h1m5 0h1M7 25h1m5 0h1m5 0h1m5 0h1"
            strokeWidth="1.1"
          />
          <path className="sni-motion-curve" d="M8 14q6 2 9 7l6-7" />
          <circle className="sni-motion-node" cx="23" cy="14" r="2" fill="var(--background)" />
        </>
      )}
      {kind === "providers" && (
        <>
          <path className="sni-antenna" d="M16 9V5" />
          <circle cx="16" cy="4" r="1.7" fill="currentColor" stroke="none" />
          <path
            d="M4 15h2v8H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm24 0h-2v8h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z"
            fill="none"
          />
          <path
            fillRule="evenodd"
            d="M16 8C9 8 5 12 5 19s4 10 11 10 11-3 11-10S23 8 16 8Zm-5 7a4 4 0 0 0 0 8h10a4 4 0 0 0 0-8Z"
            fill="currentColor"
            fillOpacity=".04"
          />
          <g className="sni-robot-gaze" fill="currentColor" stroke="none">
            <ellipse className="sni-robot-eye" cx="12" cy="19" rx="1.2" ry="1.4" />
            <ellipse className="sni-robot-eye" cx="20" cy="19" rx="1.2" ry="1.4" />
          </g>
        </>
      )}
      {kind === "themes" && (
        <>
          <path d="M19 26H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v5M4 10h22" />
          <path d="M8 7h.1m4 0h.1m4 0h.1" strokeWidth="1.1" />
          <g className="sni-roller">
            <rect
              x="12"
              y="13"
              width="17"
              height="8"
              rx="2.5"
              fill="currentColor"
              fillOpacity=".06"
            />
            <path d="M16 13v4a1.5 1.5 0 0 0 3 0v-1a1.5 1.5 0 0 1 3 0v3M29 18h1v5l-8 2v2" />
            <rect x="20" y="26" width="4" height="5" rx="1.5" />
          </g>
        </>
      )}
      {kind === "notifications" && (
        <>
          <g className="sni-bell">
            <path d="M8 21h16l-2-3v-6a6 6 0 0 0-12 0v6ZM14 5h4" />
            <path d="M13 25a3 3 0 0 0 6 0" />
          </g>
          <path className="sni-bell-signal" d="m5 10-1 3m23-3 1 3" />
        </>
      )}
      {kind === "usage" && (
        <>
          <path d="M6 25a12 12 0 1 1 20 0M7 15l2 1m5-10v3m10 2-2 2M7 25h18" />
          <g className="sni-gauge-needle">
            <path d="m16 20 6-8" />
            <circle cx="16" cy="20" r="2" fill="currentColor" />
          </g>
        </>
      )}
      {kind === "documentation" && (
        <>
          <path d="M16 8c-4-3-9-3-13-2v20c4-1 9-1 13 2 4-3 9-3 13-2V6c-4-1-9-1-13 2Zm0 0v20" />
          <g className="sni-book-lines">
            <path d="m7 11 5 1m-5 4 5 1m8-5 5-1m-5 6 5-1m-5 6 4-1" />
          </g>
          <path
            className="sni-book-page"
            d="M16 8c3-3 5-4 9-4v19c-4 0-6 2-9 5"
            fill="var(--background)"
          />
        </>
      )}
      {kind === "source-control" && (
        <>
          <path d="M9 9v14m0-5c0-8 14 0 14-10" />
          <circle cx="9" cy="6" r="3" />
          <circle cx="9" cy="26" r="3" />
          <circle cx="23" cy="5" r="3" />
          <circle className="sni-commit" cx="16" cy="15" r="2" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "keybindings" && (
        <>
          <rect x="2.5" y="7" width="27" height="19" rx="3" />
          <path
            d="M7 12h.1m5 0h.1m5 0h.1m5 0h.1M7 17h.1m5 0h.1m10 0h.1M9 22h13"
            strokeWidth="1.1"
          />
          <rect
            className="sni-key"
            x="15"
            y="15"
            width="4"
            height="4"
            rx="1"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
    </svg>
  );
}
