import type { SVGProps } from "react";

/** A friendly code ghost whose expression is a pair of angle brackets. */
export function CodeGlyphIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-tool-mark="code" {...props}>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20v-9a9 9 0 0 1 18 0v9c0 1.3-1.4 2-2.5 1.3L16 20l-2.6 1.5a2.8 2.8 0 0 1-2.8 0L8 20l-2.5 1.3C4.4 22 3 21.3 3 20Z" />
        <path className="tool-code-eye" d="m9 9-3 3 3 3" />
        <path className="tool-code-eye tool-code-eye-right" d="m15 9 3 3-3 3" />
      </g>
    </svg>
  );
}
