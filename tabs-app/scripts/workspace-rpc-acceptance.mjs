import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
let logs = "";
let bootstrapPipeError;
let childSpawnError;
const appendLog = (chunk) => {
  logs = (logs + chunk.toString("utf8")).slice(-20_000);
};
child.stdout.on("data", (x) => {
  appendLog(x);
});
child.stderr.on("data", (x) => {
  appendLog(x);
});
child.on("error", (error) => {
  childSpawnError = error;
  appendLog(`Server process error: ${error.message}\n`);
});

let ws;
try {
  const bootstrapPipe = child.stdio[3];
  if (!bootstrapPipe) throw Error("Server process did not expose bootstrap fd 3.");
  bootstrapPipe.on("error", (error) => {
    bootstrapPipeError = error;
    appendLog(`Bootstrap pipe error: ${error.message}\n`);
  });
  bootstrapPipe.end(
    JSON.stringify({
      mode: "desktop",
      noBrowser: true,
      port,
      host: "127.0.0.1",
      tabsHome: join(scratch, "data"),
      desktopBootstrapToken: token,
    }) + "\n",
  );

  let serverReady = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw Error(
        `Server exited before HTTP readiness (code=${child.exitCode}, signal=${child.signalCode}, error=${childSpawnError?.message ?? "none"}).\n${logs.slice(-1500)}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) {
        throw Error(`Environment descriptor returned HTTP ${response.status}.`);
      }
      const descriptor = await response.json();
      assert.equal(typeof descriptor.serverVersion, "string");
      serverReady = true;
      break;
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw Error(
          `Server exited before HTTP readiness (code=${child.exitCode}, signal=${child.signalCode}, error=${childSpawnError?.message ?? "none"}).\n${logs.slice(-1500)}`,
          { cause: error },
        );
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!serverReady) {
    const pipeDetails = bootstrapPipeError
      ? `\nBootstrap pipe error: ${bootstrapPipeError.message}`
      : "";
    throw Error(
      `Server did not return a healthy environment descriptor within 30 seconds.${pipeDetails}\n${logs.slice(-1500)}`,
    );
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
  const pipeDetails = bootstrapPipeError
    ? `\nBootstrap pipe error: ${bootstrapPipeError.message}`
    : "";
  const failure = `${error.stack ?? error}${pipeDetails}\nChild log tail:\n${logs.slice(-5000)}`;
  await writeFile(join(tmpdir(), "tabs-workspace-rpc-acceptance-failure.log"), failure);
  throw Error(failure, { cause: error });
} finally {
  ws?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(scratch, { recursive: true, force: true });
}
