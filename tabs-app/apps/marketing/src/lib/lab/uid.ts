/** Deterministic per-build ids for inlined SVGs. */
let n = 0;
export const nextUid = (prefix = "pv") => `${prefix}${(n++).toString(36)}`;
