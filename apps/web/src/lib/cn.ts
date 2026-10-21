import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/** Class composition without pulling protocol schemas into first paint. */
export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
