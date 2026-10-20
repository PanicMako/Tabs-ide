// Test-only entry: the parent supplies a disposable profile and owns cleanup.
const { app } = require("electron");
const { performance } = require("node:perf_hooks");
const started = performance.now();
const mark = (stage) =>
  process.stdout.write(
    `TABS_STARTUP_SAMPLE ${JSON.stringify({ stage, ms: performance.now() - started })}\n`,
  );

mark("entry");
app.on("ready", () => mark("electron-ready"));
app.on("browser-window-created", (_event, window) => {
  mark("window-created");
  window.once("ready-to-show", () => mark("first-paint"));
  window.webContents.on("console-message", (details) => {
    if (details.message?.includes("[startup] workspace-interactive:")) {
      mark("workspace-interactive");
      // Bypass the normal user quit-confirmation dialog in this disposable run.
      // The parent always terminates the backend and other descendants too.
      setTimeout(() => app.exit(0), 100);
    }
  });
});
require("../dist-electron/main.js");
