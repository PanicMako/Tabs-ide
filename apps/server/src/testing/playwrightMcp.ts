import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createConnection } from "@playwright/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export interface PlaywrightMcpSession {
  readonly call: (name: string, arguments_: Record<string, unknown>) => Promise<string>;
  readonly close: () => Promise<void>;
}

function findCachedChromiumExecutable(): string | undefined {
  const cacheRoot = join(homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(cacheRoot)) return undefined;
  const candidates = readdirSync(cacheRoot)
    .filter((entry) => entry.startsWith("chromium_headless_shell-"))
    .toSorted()
    .toReversed()
    .flatMap((entry) => [
      join(cacheRoot, entry, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
      join(cacheRoot, entry, "chrome-mac", "headless_shell"),
      join(cacheRoot, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
    ]);
  return candidates.find(existsSync);
}

export function resolveChromiumExecutable(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return findCachedChromiumExecutable();
}

function responseText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content =
    typeof result === "object" && result !== null && "content" in result
      ? result.content
      : undefined;
  const text = (Array.isArray(content) ? content : [])
    .filter(
      (item): item is { readonly type: "text"; readonly text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
  if (typeof result === "object" && result !== null && "isError" in result && result.isError) {
    throw new Error(text || "Playwright MCP tool call failed");
  }
  return text;
}

export async function createPlaywrightMcpSession(input: {
  readonly profilePath: string;
  readonly outputPath: string;
  readonly headless: boolean;
  readonly cdpEndpoint?: string;
}): Promise<PlaywrightMcpSession> {
  mkdirSync(input.profilePath, { recursive: true });
  mkdirSync(input.outputPath, { recursive: true });
  const executablePath = resolveChromiumExecutable();
  const server = await createConnection({
    browser: input.cdpEndpoint
      ? {
          browserName: "chromium",
          cdpEndpoint: input.cdpEndpoint,
        }
      : {
          browserName: "chromium",
          userDataDir: input.profilePath,
          launchOptions: {
            headless: input.headless,
            ...(executablePath ? { executablePath } : {}),
          },
        },
    capabilities: ["core", "storage"],
    outputDir: input.outputPath,
    saveSession: false,
    sharedBrowserContext: true,
  });
  const client = new Client({ name: "tabs-testing-crawler", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    call: async (name, arguments_) =>
      responseText(await client.callTool({ name, arguments: arguments_ })),
    close: async () => {
      try {
        await client.callTool({ name: "browser_close", arguments: {} });
      } catch {
        // Closing is best-effort; transport shutdown below still releases the browser.
      }
      await client.close();
      await server.close();
    },
  };
}

export function extractAccessibilityYaml(response: string): string {
  const match = response.match(/```yaml\n([\s\S]*?)\n```/);
  if (match?.[1] === undefined) {
    throw new Error("Playwright MCP did not return an inline accessibility snapshot");
  }
  return match[1];
}

export function extractPageUrl(response: string): string | null {
  return response.match(/^- Page URL:\s*(.+)$/m)?.[1]?.trim() ?? null;
}
