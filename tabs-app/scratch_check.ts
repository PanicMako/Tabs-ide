import { ThreadId } from "./packages/contracts/src/baseSchemas.ts";
console.log("Keys:", Object.keys(ThreadId));
console.log("makeUnsafe type:", typeof (ThreadId as any).makeUnsafe);
