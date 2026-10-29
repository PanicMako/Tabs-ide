import type { SVGProps } from "react";

/** A solid saucer above a closed landing beam, without decorative stars. */
export function DockUfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-tool-mark="dock" {...props}>
      <path fill="currentColor" stroke="none" d="M6.8 8a5.2 5.2 0 0 1 10.4 0Z" />
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M1.5 9.5c0-4 21-4 21 0 0 1.5-4.5 2.8-6.3 2.8-1-1.4-7.4-1.4-8.4 0-1.8 0-6.3-1.3-6.3-2.8ZM3 9.2c4.6-2.3 13.4-2.3 18 0-4.9-1.1-13.1-1.1-18 0Z"
      />
      <ellipse cx="12" cy="13" rx="3.5" ry="1.3" fill="currentColor" stroke="none" />
      <g
        className="tool-ufo-beam"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 15.3-3 4.9m9-4.9 3 4.9" />
        <ellipse cx="12" cy="20.2" rx="6" ry="1.8" />
      </g>
    </svg>
  );
}
