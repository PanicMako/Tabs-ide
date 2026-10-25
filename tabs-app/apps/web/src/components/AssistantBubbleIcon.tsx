import type { SVGProps } from "react";

/** A compact, theme-aware assistant mark shared by the Agents and Code tools. */
export function AssistantBubbleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20.5 11.3c0 4.4-3.7 7.7-8.5 7.7h-1.4l-3.4 2 .4-3.1C4.8 16.6 3 14.2 3 11.3 3 6.9 6.8 3.5 11.7 3.5s8.8 3.4 8.8 7.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <g className="tool-assistant-gaze">
        <ellipse
          className="tool-assistant-eye"
          cx="9"
          cy="10.7"
          rx="1.25"
          ry="1.8"
          fill="currentColor"
        />
        <ellipse
          className="tool-assistant-eye"
          cx="14.5"
          cy="10.7"
          rx="1.25"
          ry="1.8"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}
