import * as Net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CodeControlChannel } from "./codeControlChannel";

const channels: CodeControlChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.dispose();
  }
});

describe("CodeControlChannel extension-host readiness", () => {
  it("resolves only after an authenticated project handshake", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    const { url, token } = await channel.start();
    const address = new URL(url);
    const ready = channel.waitForExtensionHost("project-a", 1_000);
    const socket = Net.createConnection(Number(address.port), address.hostname);

    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(`${JSON.stringify({ type: "hello", token, projectId: "project-a" })}\n`);

    await expect(ready).resolves.toBeUndefined();
    expect(channel.isExtensionHostConnected("project-a")).toBe(true);
    socket.destroy();
  });

  it("rejects when the extension host never connects", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    await channel.start();

    await expect(channel.waitForExtensionHost("missing", 10)).rejects.toThrow(
      "integration extension did not connect",
    );
  });

  it("rejects pending readiness checks when disposed", async () => {
    const channel = new CodeControlChannel();
    await channel.start();
    const ready = channel.waitForExtensionHost("project-a", 1_000);

    channel.dispose();

    await expect(ready).rejects.toThrow("disposed before startup completed");
  });

  it("broadcasts and replays theme updates including fontPreferences", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    const { url, token } = await channel.start();
    const address = new URL(url);

    channel.setTheme(
      "tabs-dark",
      { baseVariant: "dark" },
      { editorFont: "JetBrains Mono", fontSizeCode: 14 },
    );

    const socket = Net.createConnection(Number(address.port), address.hostname);
    await new Promise<void>((resolve) => socket.once("connect", resolve));

    const receivedChunks: string[] = [];
    socket.on("data", (chunk) => {
      receivedChunks.push(chunk.toString("utf8"));
    });

    socket.write(`${JSON.stringify({ type: "hello", token, projectId: "project-replay" })}\n`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for replayed theme")),
        1_000,
      );
      const check = () => {
        const full = receivedChunks.join("");
        if (full.includes('"type":"setTheme"') && full.includes("JetBrains Mono")) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

    const parsed = JSON.parse(receivedChunks.join("").trim());
    expect(parsed).toMatchObject({
      type: "setTheme",
      theme: "tabs-dark",
      customConfig: { baseVariant: "dark" },
      fontPreferences: { editorFont: "JetBrains Mono", fontSizeCode: 14 },
    });

    socket.destroy();
  });
});
