import type { SVGProps } from "react";

/** A rising ringed planet, drawn in the toolbar's current theme color. */
export function BrowserPlanetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <g transform="translate(24 0) scale(-1 1)" fill="currentColor" stroke="none">
        <path d="M4.6 8.3C7 2.6 12.4 1.4 16.7 4.2c3.8 2.5 4.4 6.4 3.5 10.3-4 1.5-13.1-1.9-15.6-6.2Z" />
        <path
          className="tool-planet-ring"
          d="M5.5 4.7C1.5 5.1.3 8.5 3.4 11.8c5.1 5.7 15.1 9.9 18.6 5.9 1.2-1.6.3-4-.4-5.3-.1 4.1-1 4.7-4 4.2-6.3-.8-12.8-4.2-13.9-7.3-.4-1.1.5-3.1 1.8-4.6Z"
        />
        <path d="M3.5 13.2c1.1 5.6 7.7 9.8 14 5.8-5.3-.1-10.6-2.5-14-5.8Z" />
      </g>
    </svg>
  );
}
