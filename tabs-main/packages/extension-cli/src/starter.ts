import * as FS from "node:fs";
import * as Path from "node:path";
import { validateTabsExtensionManifest } from "@tabs/shared/extensions";
import { TABS_EXTENSION_API_VERSION } from "@tabs/extension-api";

export function initProject(
  directory: string,
  options: {
    publisher: string;
    name: string;
    template: "react" | "html";
    sdk?: string | undefined;
    tabsVersion?: string | undefined;
  },
): void {
  const manifest = {
    manifestVersion: 1,
    publisher: options.publisher,
    name: options.name,
    version: "0.1.0",
    displayName: options.name,
    description: "My first Tabs workspace tool.",
    engines: { tabs: ">=1.3.0 <2.0.0", api: `^${TABS_EXTENSION_API_VERSION}` },
    listing: { readme: "README.md", categories: ["productivity"] },
    contributes: { tools: [{ id: "main", label: options.name, entry: "dist/index.html" }] },
  };
  const validated = validateTabsExtensionManifest(manifest, options.tabsVersion ?? null);
  if (!validated.ok) throw new Error(validated.errors.join("\n"));
  if (options.sdk && !FS.statSync(options.sdk).isFile())
    throw new Error("SDK must be a local package tarball.");
  FS.mkdirSync(directory);
  const put = (file: string, contents: string) => {
    FS.mkdirSync(Path.dirname(Path.join(directory, file)), { recursive: true });
    FS.writeFileSync(Path.join(directory, file), contents, { flag: "wx" });
  };
  const react = options.template === "react";
  put("tabs-extension.json", `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.tabsVersion)
    put(".tabsext.json", `${JSON.stringify({ tabsVersion: options.tabsVersion }, null, 2)}\n`);
  put(
    "package.json",
    `${JSON.stringify(
      {
        name: options.name,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          build: react
            ? "tsc --noEmit && vite build && node scripts/stage.mjs"
            : "node scripts/stage.mjs",
          dev: react ? "vite build --watch" : "node scripts/watch.mjs",
        },
        ...(react
          ? {
              dependencies: { react: "19.2.0", "react-dom": "19.2.0" },
              devDependencies: {
                "@tabs/extension-api": options.sdk
                  ? `file:${Path.resolve(options.sdk)}`
                  : `^${TABS_EXTENSION_API_VERSION}`,
                "@types/react": "19.2.2",
                "@types/react-dom": "19.2.2",
                typescript: "5.9.3",
                vite: "8.3.1",
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
  put(
    "README.md",
    `# ${options.name}\n\nA full-workspace Tabs tool. No privileged capabilities requested.\n\nBuild with npm run build, load .tabs-extension in Tabs desktop development mode, then enable the tool in Installed.\n\nAPI ${TABS_EXTENSION_API_VERSION} is experimental. Public SDK publication and official Exchange submissions are not enabled yet.\n`,
  );
  put(".gitignore", "node_modules/\n.tabs-extension/\n*.tabsext\n.env\n");
  put(
    "scripts/stage.mjs",
    `import { mkdirSync, copyFileSync, cpSync } from "node:fs";
mkdirSync(".tabs-extension/dist", { recursive: true });
copyFileSync("tabs-extension.json", ".tabs-extension/tabs-extension.json");
copyFileSync("README.md", ".tabs-extension/README.md");
${react ? "" : 'cpSync("ui", ".tabs-extension/dist", { recursive: true });'}
`,
  );
  if (!react)
    put(
      "scripts/watch.mjs",
      'import { watch } from "node:fs";\nimport { spawn } from "node:child_process";\nlet running=false,pending=false;\nfunction build(){if(running){pending=true;return}running=true;const child=spawn(process.execPath,["scripts/stage.mjs"],{stdio:"inherit"});child.on("exit",()=>{running=false;if(pending){pending=false;build()}})}\nwatch("ui",{recursive:true},build);build();\n',
    );
  const css =
    ":root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0}main{max-width:48rem;margin:auto;padding:2rem}button{font:inherit;padding:.7rem 1rem}button:focus-visible{outline:3px solid #568aff;outline-offset:3px}\n";
  if (react) {
    put(
      "index.html",
      '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Tabs tool</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    );
    put(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({base:"./",build:{outDir:".tabs-extension/dist",emptyOutDir:true}});\n',
    );
    put(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            lib: ["ES2022", "DOM"],
            types: ["@tabs/extension-api"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );
    put(
      "src/main.tsx",
      'import { useState } from "react";\nimport { createRoot } from "react-dom/client";\nimport "./style.css";\nfunction App(){const [message,setMessage]=useState("");return <main><h1>My first Tabs tool</h1><p>This is your full workspace.</p><button type="button" onClick={()=>setMessage("Hello from your extension!")}>Try your tool</button><p role="status">{message}</p></main>}\ncreateRoot(document.getElementById("root")!).render(<App/>);\n',
    );
    put("src/style.css", css);
  } else {
    put(
      "ui/index.html",
      '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Tabs tool</title><link rel="stylesheet" href="./style.css"><script type="module" src="./app.js"></script></head><body><main><h1>My first Tabs tool</h1><button id="hello" type="button">Try your tool</button><p id="status" role="status"></p></main></body></html>\n',
    );
    put(
      "ui/app.js",
      'document.querySelector("#hello").addEventListener("click",()=>{document.querySelector("#status").textContent="Hello from your extension!"});\n',
    );
    put("ui/style.css", css);
  }
}
