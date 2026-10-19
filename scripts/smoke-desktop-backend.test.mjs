import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const runner = process.env.VITEST ? await import("vitest") : await import("node:test");
const { afterEach, test } = runner;

const script = fileURLToPath(new URL("./smoke-desktop-backend.mjs", import.meta.url));
const fixtures = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function runSmoke({ status = 200, descriptor, ended = false }) {
  const directory = await mkdtemp(join(tmpdir(), "tabs-desktop-backend-smoke-test-"));
  let server;
  let child;
  let childClosed;
  const fixture = {
    async close() {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await childClosed;
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);

  server = createServer((request, response) => {
    if (request.url !== "/.well-known/t3/environment") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(descriptor));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const desktopLog = join(directory, "desktop-main.log");
  const serverLog = join(directory, "server-child.log");
  await writeFile(
    desktopLog,
    `bootstrap native Code-OSS main-process backend started\nbootstrap resolved websocket endpoint baseUrl=ws://127.0.0.1:${port}\n`,
  );
  await writeFile(
    serverLog,
    `---- APP SESSION START run=fixture ----\n${ended ? "---- APP SESSION END run=fixture ----\n" : ""}`,
  );

  child = spawn(process.execPath, [script, desktopLog, serverLog], {
    env: { ...process.env, TABS_SMOKE_BACKEND_TIMEOUT_MS: "1500" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => (output += chunk.toString("utf8")));
  childClosed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const result = await childClosed;
  return { ...result, output, serverLog: await readFile(serverLog, "utf8") };
}

test("accepts an active packaged workspace backend with a valid descriptor", async () => {
  const result = await runSmoke({
    descriptor: { environmentId: "fixture", serverVersion: "2.0.0", label: "Fixture" },
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /valid environment descriptor and remained stable/);
});

test("rejects a packaged backend that returns an unhealthy descriptor", async () => {
  const result = await runSmoke({
    status: 503,
    descriptor: { error: "not ready" },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /HTTP 503/);
});

test("rejects a workspace server process that has already exited", async () => {
  const result = await runSmoke({
    ended: true,
    descriptor: { environmentId: "fixture", serverVersion: "2.0.0", label: "Fixture" },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /found 1 starts and 1 exits/);
});
