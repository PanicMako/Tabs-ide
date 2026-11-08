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

it("routes validated rail presentation only to its owning project", async () => {
  const channel = new CodeControlChannel();
  channels.push(channel);
  const { url, token } = await channel.start();
  const address = new URL(url);
  const socket = Net.createConnection(Number(address.port), address.hostname);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  const messages: string[] = [];
  socket.on("data", (chunk) => messages.push(chunk.toString("utf8")));
  socket.write(`${JSON.stringify({ type: "hello", token, projectId: "rail-owner" })}\n`);
  await channel.waitForExtensionHost("rail-owner", 1000);
  const presentation = {
    selectionY: 0.25,
    spotlight: true,
    label: { text: "Source Control", y: 0.5 },
  };
  expect(channel.runCommand("other-project", "_tabs.setRailPresentation", presentation)).toBe(
    false,
  );
  expect(
    channel.runCommand("rail-owner", "_tabs.setRailPresentation", {
      ...presentation,
      selectionY: NaN,
    }),
  ).toBe(false);
  expect(channel.runCommand("rail-owner", "workbench.view.scm", presentation)).toBe(false);
  expect(channel.runCommand("rail-owner", "_tabs.setRailPresentation", presentation)).toBe(true);
  await expect.poll(() => messages.join("")).toContain("_tabs.setRailPresentation");
  const command = messages
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((value) => value.commandId === "_tabs.setRailPresentation");
  expect(command.presentation).toEqual(presentation);
  socket.destroy();
});

describe("CodeControlChannel commit drafts", () => {
  async function connect(channel: CodeControlChannel) {
    const { url, token } = await channel.start();
    const address = new URL(url);
    const socket = Net.createConnection(Number(address.port), address.hostname);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const ready = channel.waitForExtensionHost("project-a", 1_000);
    socket.write(`${JSON.stringify({ type: "hello", token, projectId: "project-a" })}\n`);
    await ready;
    return socket;
  }
  it("returns a draft on the authenticated connection", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    channel.onGenerateCommitDraft(async (projectId, cwd) => {
      expect(projectId).toBe("project-a");
      expect(cwd).toBe("/project");
      return "Improve documentation";
    });
    const socket = await connect(channel);
    const reply = new Promise<string>((resolve) =>
      socket.once("data", (chunk) => resolve(chunk.toString())),
    );
    socket.write(
      `${JSON.stringify({ type: "generateCommitDraft", projectId: "project-a", requestId: "request-1", cwd: "/project" })}\n`,
    );
    expect(JSON.parse(await reply)).toEqual({
      type: "commitDraftResult",
      requestId: "request-1",
      message: "Improve documentation",
    });
    socket.destroy();
  });
  it("aborts generation when the extension disconnects", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let markAborted: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    channel.onGenerateCommitDraft(
      (_projectId, _cwd, signal) =>
        new Promise<string>(() => {
          signal.addEventListener("abort", markAborted, { once: true });
          markStarted();
        }),
    );
    const socket = await connect(channel);
    socket.write(
      `${JSON.stringify({ type: "generateCommitDraft", projectId: "project-a", requestId: "request-1", cwd: "/project" })}\n`,
    );
    await started;
    socket.destroy();
    await aborted;
  });
  it("rejects a request claiming a different project", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    let called = false;
    channel.onGenerateCommitDraft(async () => {
      called = true;
      return "Wrong project";
    });
    const socket = await connect(channel);
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.write(
      `${JSON.stringify({ type: "generateCommitDraft", projectId: "project-b", requestId: "request-1", cwd: "/project" })}\n`,
    );
    await closed;
    expect(called).toBe(false);
  });
});

describe("CodeControlChannel project isolation", () => {
  async function connect(channel: CodeControlChannel, projectId: string) {
    const { url, token } = await channel.start();
    const address = new URL(url);
    const socket = Net.createConnection(Number(address.port), address.hostname);
    const messages: string[] = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => messages.push(String(chunk)));
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(`${JSON.stringify({ type: "hello", token, projectId })}\n`);
    return { socket, messages };
  }

  it.each(["", "   "])(
    "rejects anonymous identity %j without satisfying project waiters",
    async (projectId) => {
      const channel = new CodeControlChannel();
      channels.push(channel);
      const a = expect(channel.waitForExtensionHost("a", 100)).rejects.toThrow("did not connect");
      const b = expect(channel.waitForExtensionHost("b", 100)).rejects.toThrow("did not connect");
      const { socket } = await connect(channel, projectId);
      await new Promise<void>((resolve) => socket.once("close", resolve));
      await Promise.all([a, b]);
      expect(channel.isExtensionHostConnected("never-registered")).toBe(false);
      expect(channel.openFile("never-registered", "/private.md")).toBe(false);
    },
  );

  it("routes commands and files to their project through reconnects", async () => {
    const channel = new CodeControlChannel();
    channels.push(channel);
    const firstA = await connect(channel, "a");
    const b = await connect(channel, "b");
    await Promise.all([
      channel.waitForExtensionHost("a", 1000),
      channel.waitForExtensionHost("b", 1000),
    ]);
    expect(channel.runCommand("a", "workbench.action.terminal.new")).toBe(true);
    expect(channel.openFile("b", "/b/private.md")).toBe(true);
    expect(channel.runCommand("unknown", "workbench.action.terminal.new")).toBe(false);
    await expect.poll(() => firstA.messages.join("")).toContain("terminal.new");
    await expect.poll(() => b.messages.join("")).toContain("/b/private.md");
    expect(firstA.messages.join("")).not.toContain("/b/private.md");
    expect(b.messages.join("")).not.toContain("terminal.new");
    const oldClosed = new Promise<void>((resolve) => firstA.socket.once("close", resolve));
    const replacementA = await connect(channel, "a");
    await oldClosed;
    expect(channel.isExtensionHostConnected("b")).toBe(true);
    expect(channel.runCommand("a", "workbench.action.terminal.new")).toBe(true);
    await expect.poll(() => replacementA.messages.join("")).toContain("terminal.new");
    replacementA.socket.destroy();
    await expect.poll(() => channel.isExtensionHostConnected("a")).toBe(false);
    expect(channel.isExtensionHostConnected("b")).toBe(true);
    b.socket.destroy();
  });
});
