import * as Effect from "effect/Effect";

// This migration intentionally became a no-op: the runtime-mode column was
// introduced by migration 004, but the historical sequence must remain stable.
export default Effect.void;
