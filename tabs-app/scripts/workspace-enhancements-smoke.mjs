/** Connect only to the isolated Electron instance described in the review guide. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, unlink, utimes } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const testHome = join(root, ".maintenance-validation", "app-home");
const evidence = join(root, "docs", "implementation", "workspace-enhancements");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = () => browser.contexts().flatMap((context) => context.pages());
const main = pages().find(
  (page) =>
    /^http:\/\/localhost:\d+/.test(page.url()) && !page.url().includes("conversationPopout"),
);
assert(main, "Launch the isolated app with bun run dev:desktop first.");
try {
  await main.waitForFunction(() => Boolean(window.__tabsNativeApi));
  const configPath = await main.evaluate(
    async () => (await window.__tabsNativeApi.server.getConfig()).keybindingsConfigPath,
  );
  assert(configPath.startsWith(testHome + "/"), "Refusing to run against user application data.");
  const repo = join(root, ".maintenance-validation", "repo");
  await mkdir(repo, { recursive: true });
  await mkdir(evidence, { recursive: true });
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: "pipe" });
  try {
    git("rev-parse", "HEAD");
  } catch {
    git("init", "-b", "main");
    git(
      "-c",
      "user.name=Smoke",
      "-c",
      "user.email=smoke@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
  }
  const environmentId = await main.evaluate(async (workspaceRoot) => {
    const api = window.__tabsNativeApi;
    const snapshot = await api.orchestration.getSnapshot();
    const projectId = "enhancements-smoke-project";
    if (!snapshot.projects.some((project) => project.id === projectId))
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId,
        title: "Workspace enhancements review",
        workspaceRoot,
      });
    for (const threadId of ["enhancements-smoke-one", "enhancements-smoke-two"]) {
      if (!snapshot.threads.some((thread) => thread.id === threadId))
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: crypto.randomUUID(),
          threadId,
          projectId,
          title:
            threadId === "enhancements-smoke-one"
              ? "Conversation continuity review"
              : "Parallel task review",
          modelSelection: { instanceId: "codex", model: "gpt-6.1-sol" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        });
    }
    return (await api.orchestration.getSnapshot()).projects.find(
      (project) => project.id === projectId,
    ).environmentId;
  }, repo);
  await main.evaluate((env) => {
    location.hash = `/${env}/enhancements-smoke-one`;
  }, environmentId);
  await main.getByRole("button", { name: "Pop out conversation", exact: true }).waitFor();
  const open = (id) =>
    main.evaluate(
      async ({ env, id }) =>
        window.desktopBridge.openPopoutWindow({
          url: `/${env}/${id}?conversationPopout=true`,
          title: "Tabs agent review",
          width: 840,
          height: 760,
        }),
      { env: environmentId, id },
    );
  await open("enhancements-smoke-one");
  await open("enhancements-smoke-two");
  await main.waitForTimeout(700);
  await open("enhancements-smoke-one");
  assert.equal(pages().filter((page) => page.url().includes("conversationPopout")).length, 2);
  const popup = pages().find((page) => page.url().includes("enhancements-smoke-one?"));
  const title = `Synchronized conversation ${Date.now()}`;
  await main.evaluate(
    async (title) =>
      window.__tabsNativeApi.orchestration.dispatchCommand({
        type: "thread.metadata.update",
        commandId: crypto.randomUUID(),
        threadId: "enhancements-smoke-one",
        title,
      }),
    title,
  );
  await popup.getByRole("heading", { name: title, exact: true }).waitFor();
  await main.getByRole("heading", { name: title, exact: true }).waitFor();
  await popup.screenshot({ path: join(evidence, "conversation-window.png") });
  await pages()
    .find((page) => page.url().includes("enhancements-smoke-two?"))
    .close();
  assert.equal(
    await main.evaluate(
      async () =>
        (await window.__tabsNativeApi.orchestration.getSnapshot()).threads.filter((t) =>
          t.id.startsWith("enhancements-smoke-"),
        ).length,
    ),
    2,
  );
  await popup.getByRole("button", { name: "Dock conversation", exact: true }).click();
  await main.waitForTimeout(150);
  assert.equal(pages().filter((page) => page.url().includes("conversationPopout")).length, 0);

  await main.evaluate(() => {
    location.hash = "/settings?section=quick-actions";
  });
  await main.getByRole("heading", { name: "Quick Actions", exact: true }).waitFor();
  for (const [index, name] of ["halo-fade", "glass-dial", "pie-sectors"].entries()) {
    await main.locator('[aria-label="Launcher designs"] button').nth(index).click();
    await main.locator(".qa-preview").screenshot({ path: join(evidence, `launcher-${name}.png`) });
  }
  await main.locator('[aria-label="Launcher designs"] button').nth(2).click();
  const useDesign = main.getByRole("button", { name: "Use this design", exact: true });
  if ((await useDesign.count()) && (await useDesign.isEnabled())) await useDesign.click();
  await main.reload();
  await main.locator('[aria-label="Launcher designs"] button[aria-pressed=true]').waitFor();
  assert.match(
    await main.locator('[aria-label="Launcher designs"] button[aria-pressed=true]').innerText(),
    /Pie Sectors/,
  );
  await main.keyboard.press(process.platform === "darwin" ? "Meta+Alt+K" : "Control+Alt+K");
  await main.locator(".qa-popup .qa-radial-sectors").waitFor();
  await main.keyboard.press("Escape");

  await main.evaluate(async () =>
    window.__tabsNativeApi.server.upsertKeybinding({
      key: "mod+alt+shift+k",
      command: "quickActions.toggle",
    }),
  );
  try {
    await main.keyboard.press(
      process.platform === "darwin" ? "Meta+Alt+Shift+K" : "Control+Alt+Shift+K",
    );
    await main.locator(".qa-popup").waitFor();
    await main.keyboard.press("Escape");
  } finally {
    await main.evaluate(async () =>
      window.__tabsNativeApi.server.removeKeybinding({
        key: "mod+alt+shift+k",
        command: "quickActions.toggle",
      }),
    );
  }
  await main
    .getByRole("checkbox", { name: "Alt + right-click in workspace chrome to open at the pointer" })
    .check();
  const viewport = await main.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await main.keyboard.down("Alt");
  await main.mouse.click(viewport.width - 20, viewport.height - 20, { button: "right" });
  await main.keyboard.up("Alt");
  await main.locator(".qa-popup").waitFor();
  assert(
    await main.locator(".qa-popup").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      );
    }),
  );
  await main.keyboard.press("Escape");

  const tree = await main.evaluate(
    async (cwd) =>
      (
        await window.__tabsNativeApi.git.createWorktree({
          cwd,
          branch: "HEAD",
          newBranch: `review/smoke-${Date.now()}`,
          path: null,
        })
      ).worktree,
    repo,
  );
  assert(
    tree.path.startsWith(testHome + "/"),
    "Refusing to touch a worktree outside the test home.",
  );
  await writeFile(join(tree.path, "keep.txt"), "uncommitted smoke fixture");
  assert.equal(
    await main.evaluate(
      async ({ cwd, path }) => {
        try {
          await window.__tabsNativeApi.maintenance.removeWorktree(cwd, path);
          return false;
        } catch {
          return true;
        }
      },
      { cwd: repo, path: tree.path },
    ),
    true,
  );
  await unlink(join(tree.path, "keep.txt"));
  await main.evaluate(
    async ({ cwd, path }) => window.__tabsNativeApi.maintenance.removeWorktree(cwd, path),
    { cwd: repo, path: tree.path },
  );
  assert(git("branch", "--list", tree.branch).includes(tree.branch));
  const oldLog = join(dirname(configPath), "logs", "review-smoke.log.1");
  await writeFile(oldLog, "disposable smoke fixture");
  const expired = new Date(Date.now() - 10 * 86_400_000);
  await utimes(oldLog, expired, expired);
  const cleanup = await main.evaluate(async () => {
    const api = window.__tabsNativeApi.maintenance;
    const inventory = await api.inspectStorage();
    const candidate = inventory.candidates.find((file) => file.name === "review-smoke.log.1");
    if (!candidate) throw new Error("Expected aged log fixture was not discovered.");
    return api.cleanStorage([candidate.id]);
  });
  assert.deepEqual(cleanup, { deletedBytes: 24, deletedCount: 1, errors: [] });
  await main.evaluate(() => {
    location.hash = "/settings?section=maintenance";
  });
  await main.getByRole("heading", { name: "Worktrees & Storage", exact: true }).waitFor();
  await main.getByRole("button", { name: "Refresh inventory", exact: true }).waitFor();
  await main.screenshot({ path: join(evidence, "storage-settings.png") });
  console.log(
    "PASS: two windows, deduplication, synchronization, close/dock continuity, three radial previews, design persistence, default/custom shortcuts, gesture bounds, dirty protection, branch-retaining removal and exact log cleanup.",
  );
} finally {
  await browser.close(); // Disconnect CDP; leave the developer's test instance running.
}
