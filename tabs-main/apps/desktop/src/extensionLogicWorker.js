const { parentPort } = require("node:worker_threads");
const { getQuickJS } = require("quickjs-emscripten");

// oxlint-disable unicorn/require-post-message-target-origin -- Node worker_threads has no target origin.

const MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const OUTPUT_LIMIT_BYTES = 64 * 1024;

parentPort.once("message", async ({ source, input, timeoutMs }) => {
  let runtime;
  let context;
  const handles = [];
  try {
    const QuickJS = await getQuickJS();
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(STACK_LIMIT_BYTES);
    const deadline = performance.now() + timeoutMs;
    runtime.setInterruptHandler(() => performance.now() >= deadline);
    context = runtime.newContext();

    context.unwrapResult(context.evalCode(source, "extension-logic.js")).dispose();
    const run = context.getProp(context.global, "run");
    handles.push(run);
    if (context.typeof(run) !== "function")
      throw new Error("Extension logic must define run(input).");
    const json = context.getProp(context.global, "JSON");
    handles.push(json);
    const parse = context.getProp(json, "parse");
    handles.push(parse);
    const inputHandle = context.newString(input);
    handles.push(inputHandle);
    const parsed = context.unwrapResult(context.callFunction(parse, json, inputHandle));
    handles.push(parsed);
    const result = context.unwrapResult(context.callFunction(run, context.undefined, parsed));
    handles.push(result);
    const then = context.getProp(result, "then");
    handles.push(then);
    if (context.typeof(then) === "function")
      throw new Error("Async extension logic is not supported by this probe.");
    const stringify = context.getProp(json, "stringify");
    handles.push(stringify);
    const output = context.unwrapResult(context.callFunction(stringify, json, result));
    handles.push(output);
    if (context.typeof(output) !== "string")
      throw new Error("Extension logic returned no JSON value.");
    const serialized = context.getString(output);
    if (Buffer.byteLength(serialized) > OUTPUT_LIMIT_BYTES) {
      throw new Error("Extension logic output exceeds its size limit.");
    }
    parentPort.postMessage({ ok: true, value: JSON.parse(serialized) });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 1000) : "Extension logic failed.",
    });
  } finally {
    for (const handle of handles.toReversed()) handle.dispose();
    context?.dispose();
    runtime?.dispose();
  }
});
