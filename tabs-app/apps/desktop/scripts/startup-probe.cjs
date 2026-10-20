// Test-only entry: the parent supplies a disposable profile and owns cleanup.
const { app } = require("electron");
const { performance } = require("node:perf_hooks");
const childProcess = require("node:child_process");
const spawn = childProcess.spawn;
let backend;
childProcess.spawn = function (file, args, options) {
  const child = spawn.call(this, file, args, options);
  if (args?.includes("--bootstrap-fd")) backend = child;
  return child;
};
function finish() {
  if (
    process.platform === "win32" ||
    !backend ||
    backend.exitCode !== null ||
    backend.signalCode !== null
  ) {
    app.exit(0);
    return;
  }
  // Match the real desktop's SIGTERM shutdown so Node can persist its cache.
  backend.once("exit", () => app.exit(0));
  backend.kill("SIGTERM");
  setTimeout(() => {
    mark("shutdown-timeout");
    // Production also force-stops a backend that exceeds its two-second grace.
    // Startup is already measured; the parent cleans up the full process group.
    app.exit(0);
  }, 2_000).unref();
}
const started = performance.now();
const mark = (stage) =>
  process.stdout.write(
    `TABS_STARTUP_SAMPLE ${JSON.stringify({ stage, ms: performance.now() - started })}\n`,
  );

mark("entry");
app.on("ready", () => mark("electron-ready"));
app.on("browser-window-created", (_event, window) => {
  mark("window-created");
  window.once("ready-to-show", () => mark("paintable-frame"));
  window.once("show", () => mark("window-visible"));
  window.webContents.on("console-message", (details) => {
    if (details.message?.includes("[startup] splash-first-paint:")) mark("splash-first-paint");
    if (details.message?.includes("[startup] workspace-interactive:")) {
      mark("workspace-interactive");
      // Bypass the normal user quit-confirmation dialog in this disposable run.
      // The parent always terminates the backend and other descendants too.
      setTimeout(finish, 100);
    }
  });
});
require("../dist-electron/main.js");
