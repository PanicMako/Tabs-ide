import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { extensionDocs } from "../../../apps/marketing/src/lib/extension-docs";
import type { TabsExtensionHostBridge, TabsExtensionJsonValue } from "../src/index.js";

const sdkPath = fileURLToPath(new URL("../src/index.d.ts", import.meta.url));
const snippets = extensionDocs.flatMap((page) =>
  [...page.body.matchAll(/```ts\n([\s\S]*?)```/g)].map((match, index) => ({
    name: `${page.slug || "start"} example ${index + 1}`,
    source: match[1]!,
  })),
);
const examples = snippets.filter((snippet) => snippet.source.includes("window.tabsExtension."));

function bridgeFixture() {
  const storage = new Map<string, TabsExtensionJsonValue>();
  const bridge = {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key) ?? null),
      set: vi.fn(async (key: string, value: TabsExtensionJsonValue) => {
        storage.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
    workspace: { readText: vi.fn(async () => "# A project readme") },
    git: { status: vi.fn(async () => ({ branch: "main", dirty: false })) },
    network: { getText: vi.fn(async () => "service response") },
    logic: { invoke: vi.fn(async () => 6) },
  } satisfies TabsExtensionHostBridge;
  return { bridge, storage };
}

async function execute(source: string, bridge: TabsExtensionHostBridge) {
  const consoleFixture = { log: vi.fn() };
  const run = vm.runInNewContext(
    `(async () => {${source}\n})`,
    {
      window: { tabsExtension: bridge },
      console: consoleFixture,
    },
    { timeout: 1000 },
  ) as () => Promise<void>;
  await run();
  return consoleFixture;
}

describe("published SDK documentation examples", () => {
  it("classifies every TypeScript block as usage or generated reference", () => {
    expect(examples).toHaveLength(5);
    for (const snippet of snippets) {
      expect(
        snippet.source.includes("window.tabsExtension.") ||
          snippet.source.startsWith("export const TabsExtensionManifest = Schema.Struct({") ||
          snippet.source === `${readFileSync(sdkPath, "utf8")}\n`,
      ).toBe(true);
    }
  });

  it("typechecks the exact usage examples against the public SDK declaration", () => {
    const files = new Map(
      examples.map((example, index) => [
        fileURLToPath(new URL(`./virtual-example-${index}.ts`, import.meta.url)),
        `export {};\n${example.source}`,
      ]),
    );
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      types: [],
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile;
    const originalExists = host.fileExists;
    host.readFile = (path) => files.get(path) ?? originalRead(path);
    host.fileExists = (path) => files.has(path) || originalExists(path);
    host.getSourceFile = (path, languageVersion) => {
      const source = host.readFile(path);
      return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion);
    };
    const program = ts.createProgram([sdkPath, ...files.keys()], options, host);
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
  });

  for (const example of examples) {
    it(`executes ${example.name}`, async () => {
      const { bridge, storage } = bridgeFixture();
      await execute(example.source, bridge);
      if (example.source.includes("storage.set")) {
        expect(bridge.storage.set).toHaveBeenCalledWith("draft", { text: "A local note" });
        expect(bridge.storage.get).toHaveBeenCalledWith("draft");
        expect(bridge.storage.delete).toHaveBeenCalledWith("draft");
        expect(storage.size).toBe(0);
      }
      if (example.source.includes("git.status")) expect(bridge.git.status).toHaveBeenCalledOnce();
      if (example.source.includes("network.getText")) {
        expect(bridge.network.getText).toHaveBeenCalledWith("https://api.example.com/status");
        expect(bridge.network.getText).toHaveBeenCalledWith("https://api.example.com/me", {
          useProfileCredential: true,
        });
      }
      if (example.source.includes("logic.invoke"))
        expect(bridge.logic.invoke).toHaveBeenCalledWith("sum", { values: [1, 2, 3] });
      if (example.source.includes("workspace.readText")) {
        expect(bridge.workspace.readText).toHaveBeenCalledWith("README.md");
        bridge.workspace.readText.mockRejectedValueOnce(new Error("Permission denied"));
        const output = await execute(example.source, bridge);
        expect(output.log).not.toHaveBeenCalled();
      }
    });
  }
});
