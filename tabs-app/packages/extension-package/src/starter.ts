import * as FS from "node:fs";
import * as Path from "node:path";
import type { TabsExtensionManifest } from "@tabs/extension-api";
import { validateTabsExtensionManifest } from "@tabs/shared/extensions";

/** Creates only a new directory: never replaces an existing project or follows its links. */
export function createExtensionStarter(directory: string, publisher: string, name: string): void {
  const manifest: TabsExtensionManifest = {
    manifestVersion: 1,
    publisher,
    name,
    version: "0.1.0",
    displayName: name,
    description: "My first full-workspace Tabs tool.",
    engines: { tabs: ">=1.3.0 <2.0.0", api: "^1.0.0" },
    contributes: { tools: [{ id: "main", label: name, entry: "dist/index.html" }] },
  };
  const checked = validateTabsExtensionManifest(manifest, null);
  if (!checked.ok) throw new Error(checked.errors.join("\n"));
  FS.mkdirSync(directory);
  FS.mkdirSync(Path.join(directory, "dist"));
  FS.writeFileSync(
    Path.join(directory, "tabs-extension.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  FS.writeFileSync(
    Path.join(directory, "dist/index.html"),
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>My Tabs tool</title><link rel="stylesheet" href="./style.css"><script type="module" src="./app.js"></script></head>
<body><main><h1>My first Tabs tool</h1><p>A full workspace, just for your workflow.</p><button id="greet" type="button">Try your tool</button><p id="result" role="status"></p></main></body>
</html>
`,
    { flag: "wx" },
  );
  FS.writeFileSync(
    Path.join(directory, "dist/app.js"),
    `document.querySelector("#greet").addEventListener("click", () => {
  document.querySelector("#result").textContent = "Hello from your extension!";
});
`,
    { flag: "wx" },
  );
  FS.writeFileSync(
    Path.join(directory, "dist/style.css"),
    `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; } main { max-width: 48rem; margin: auto; padding: 2rem; }
button { font: inherit; padding: .75rem 1rem; cursor: pointer; }
button:focus-visible { outline: 3px solid #568aff; outline-offset: 3px; }
`,
    { flag: "wx" },
  );
  FS.writeFileSync(
    Path.join(directory, "README.md"),
    `# ${publisher}.${name}

Edit dist/index.html, dist/app.js, and dist/style.css. No build step or capabilities are required.
Load this folder in Tabs desktop development mode: Settings > Extensions > Discover.
Enable it in Installed, then select its tool in the project toolbar.
Use the repository tabsext CLI to validate and pack before submission.
Developer guide: /developers/extensions on the Tabs website.
This is experimental; public publishing is not open yet.
`,
    { flag: "wx" },
  );
}
