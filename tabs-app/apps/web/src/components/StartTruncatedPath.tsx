import type { CSSProperties } from "react";

/**
 * A file path that loses its beginning, not its end, when it does not fit: the folders can go,
 * the file name is what you need. Right-to-left layout moves the ellipsis to the start, and the
 * inner `bdi` keeps the path itself reading left to right.
 */
export function StartTruncatedPath({
  path,
  className = "",
  style,
}: {
  path: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      title={path}
      className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left ${className}`}
      style={{ direction: "rtl", ...style }}
    >
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}
