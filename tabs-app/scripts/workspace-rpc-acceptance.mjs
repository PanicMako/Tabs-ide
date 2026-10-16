import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const root = process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "tabs-rpc-acceptance-"));
const repo = join(scratch, "repo");
execFileSync("git", ["init", "-b", "main", repo]);
execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
execFileSync("git", ["-C", repo, "config", "user.name", "RPC Acceptance"]);
execFileSync("git", ["-C", repo, "config", "commit.gpgsign", "false"]);
execFileSync("git", ["-C", repo, "config", "core.hooksPath", "/dev/null"]);
await writeFile(join(repo, "file.txt"), "base\n");
execFileSync("git", ["-C", repo, "add", "file.txt"]);
execFileSync("git", ["-C", repo, "commit", "-m", "fixture"]);
await writeFile(join(repo, "file.txt"), "changed\n");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const token = randomBytes(32).toString("hex");
const child = spawn(
  process.execPath,
  [join(root, "apps/server/dist/index.mjs"), "--bootstrap-fd", "3"],
  { cwd: repo, stdio: ["ignore", "pipe", "pipe", "pipe"] },
);
child.stdio[3].end(
  JSON.stringify({
    mode: "desktop",
    noBrowser: true,
    port,
    host: "127.0.0.1",
    tabsHome: join(scratch, "data"),
    desktopBootstrapToken: token,
  }) + "\n",
);
let logs = "";
child.stdout.on("data", (x) => {
  logs += x;
});
child.stderr.on("data", (x) => {
  logs += x;
});

let ws;
try {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw Error("Server exited early: " + logs.slice(-1500));
    try {
      await fetch(`http://127.0.0.1:${port}/api/environment`, {
        signal: AbortSignal.timeout(1000),
      });
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws?orchestrationProtocol=2&token=${token}`);
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(Error("WebSocket open timed out")), 10000);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(guard);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener("error", () => reject(Error("WebSocket upgrade failed")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(String(event.data));
    if (m._tag === "Ping") {
      ws.send(JSON.stringify({ _tag: "Pong" }));
      return;
    }
    const p = pending.get(String(m.requestId));
    if (p && m._tag === "Exit") {
      pending.delete(String(m.requestId));
      clearTimeout(p.timer);
      m.exit._tag === "Success" ? p.resolve(m.exit.value) : p.reject(Error(JSON.stringify(m.exit)));
    }
  });
  const request = (tag, payload = {}) =>
    new Promise((resolve, reject) => {
      const next = String(++id);
      const timer = setTimeout(() => reject(Error("Timeout: " + tag)), 20000);
      pending.set(next, { resolve, reject, timer });
      ws.send(JSON.stringify({ _tag: "Request", id: next, tag, payload, headers: [] }));
    });
  await request("git.stageFiles", { cwd: repo, paths: ["file.txt"] });
  assert.equal(
    execFileSync("git", ["-C", repo, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    }).trim(),
    "file.txt",
  );
  await request("git.unstageFiles", { cwd: repo, paths: ["file.txt"] });
  assert.equal(
    execFileSync("git", ["-C", repo, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    }).trim(),
    "",
  );
  await request("git.createBranch", { cwd: repo, branch: "test-branch" });
  await request("git.checkout", { cwd: repo, branch: "test-branch" });
  assert.equal(
    execFileSync("git", ["-C", repo, "branch", "--show-current"], { encoding: "utf8" }).trim(),
    "test-branch",
  );
  await assert.rejects(
    request("git.performRepositoryAction", {
      cwd: repo,
      operation: {
        action: "add_remote",
        name: "--config=malicious",
        url: "https://example.invalid/repo.git",
      },
    }),
    /Git arguments must not be command options/,
  );
  const diff = await request("git.diff", { cwd: repo, path: "file.txt" });
  assert.ok(diff);
  const terminals = await request("terminal.list");
  assert.ok(Array.isArray(terminals));
  const bundle = await request("server.createSupportBundle");
  assert.equal(bundle.mediaType, "application/json");
  assert.equal(JSON.parse(bundle.content).schemaVersion, 1);
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "real server bootstrap",
        "authenticated RPC connection",
        "stage and unstage on disposable repository",
        "create branch and checkout",
        "diff response",
        "reject option injection",
        "terminal listing",
        "support bundle export",
      ],
    }),
  );
} catch (error) {
  await writeFile(join(tmpdir(), "tabs-workspace-rpc-acceptance-failure.log"), logs);
  throw error;
} finally {
  ws?.close();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(scratch, { recursive: true, force: true });
}
