import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import * as Http from "node:http";
import { createHash } from "node:crypto";
import { serveFrontend } from "../apps/exchange/src/frontend.ts";

const repository = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-tutorial-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let server;
function run(command, args, cwd, capture = false, environment = process.env) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    timeout: 120000,
    env: environment,
  });
}
async function waitUntil(predicate, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function verifyDevelopmentWatch(cli, project, template) {
  const source = Path.join(project, template === "react" ? "src/main.tsx" : "ui/index.html");
  const original = FS.readFileSync(source, "utf8");
  const entry = Path.join(project, ".tabs-extension/dist/index.html");
  const before = FS.statSync(entry).mtimeMs;
  const child = spawn(process.execPath, [cli, "dev"], {
    cwd: project,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = false;
  child.stdout.on("data", (bytes) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    output += bytes.toString();
  });
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", (error) => {
    output += error.message;
    exited = true;
  });
  try {
    await waitUntil(() => {
      assert(!exited, `Development watcher exited early: ${output}`);
      return FS.existsSync(entry) && FS.statSync(entry).mtimeMs > before;
    }, `Development watcher did not produce its initial build: ${output}`);
    const marker = `Tutorial watch rebuilt ${template}`;
    FS.writeFileSync(source, original.replace("My first Tabs tool", marker));
    await waitUntil(() => {
      assert(!exited, `Development watcher exited before rebuilding: ${output}`);
      const assets = Path.join(project, ".tabs-extension/dist");
      return FS.readdirSync(assets, { recursive: true }).some((name) => {
        const path = Path.join(assets, name);
        return FS.statSync(path).isFile() && FS.readFileSync(path, "utf8").includes(marker);
      });
    }, `Development watcher did not rebuild changed source: ${output}`);
    child.kill("SIGTERM");
    await waitUntil(() => exited, "Development CLI did not respond to cancellation.", 5_000);
    console.log(`${template}: standalone dev rebuilt local assets and responded to cancellation`);
  } finally {
    // Bound cleanup to this verifier-owned child/process group, never an npm-wide kill.
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") {
          console.error("Could not stop the verifier-owned development process group:", error);
          process.exitCode = 1;
        }
      }
    } else if (!exited) child.kill("SIGTERM");
    FS.writeFileSync(source, original);
  }
}
try {
  run("bun", ["run", "--cwd", "apps/exchange", "build:web"], repository);
  run("bun", ["run", "--cwd", "apps/exchange", "verify:docs"], repository);
  server = Http.createServer(async (request, response) => {
    if (!(await serveFrontend(new URL(request.url, "http://localhost").pathname, response)))
      response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const metadata = await fetch(`${origin}/developers/releases/manifest.json`);
  assert.equal(metadata.status, 200);
  const release = await metadata.json();
  const version = release.apiVersion;
  for (const entry of [...release.packages, release.bundle]) {
    const response = await fetch(`${origin}${entry.url}`, { redirect: "error" });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.equal(bytes.length, entry.bytes);
    FS.writeFileSync(Path.join(temporary, Path.basename(entry.url)), bytes);
  }
  run(
    "tar",
    ["-xzf", Path.join(temporary, "tabs-developer-bundle.tar.gz"), "-C", temporary],
    temporary,
  );
  assert(
    FS.readFileSync(Path.join(temporary, "README.md"), "utf8").includes("Load development folder"),
  );
  assert(
    FS.readFileSync(Path.join(temporary, "SHA256SUMS"), "utf8").includes(
      release.packages[0].sha256,
    ),
  );
  // Downloads complete before synchronous child commands; this server is not
  // used to imply live OAuth, signing, or publication acceptance.
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
  const sdk = Path.join(temporary, `tabs-extension-api-${version}.tgz`);
  const toolchain = Path.join(temporary, "tabs-toolchain");
  run(
    npm,
    [
      "install",
      "-g",
      "--prefix",
      toolchain,
      Path.join(temporary, `tabs-extension-cli-${version}.tgz`),
    ],
    temporary,
  );
  const cli = Path.join(
    toolchain,
    process.platform === "win32"
      ? "node_modules/@tabs/extension-cli/dist/cli.js"
      : "lib/node_modules/@tabs/extension-cli/dist/cli.js",
  );
  for (const template of ["react", "html"]) {
    const project = Path.join(temporary, `${template}-tool`);
    run(
      process.execPath,
      [
        cli,
        "init",
        project,
        "--sdk",
        sdk,
        "--template",
        template,
        "--tabs-version",
        release.desktop.version,
      ],
      temporary,
    );
    run(npm, ["install"], project);
    run(npm, ["run", "build"], project);
    run(npm, ["audit", "--audit-level=high"], project);
    await verifyDevelopmentWatch(cli, project, template);
    // Restore the unmodified quickstart artifact before the independent desktop check.
    run(npm, ["run", "build"], project);
    FS.writeFileSync(Path.join(project, ".env"), "EXAMPLE_SECRET=must-not-be-packaged");
    const validated = JSON.parse(run(process.execPath, [cli, "validate", "--json"], project, true));
    assert(!validated.files.includes(".env"));
    assert(
      !validated.files.some((file) => file.startsWith("node_modules/") || file.startsWith("src/")),
    );
    const archive = Path.join(temporary, `${template}.tabsext`);
    const packed = JSON.parse(
      run(process.execPath, [cli, "pack", archive, "--json"], project, true),
    );
    const inspected = JSON.parse(
      run(process.execPath, [cli, "inspect", archive, "--json"], project, true),
    );
    assert.equal(inspected.digest, packed.digest);
    const again = JSON.parse(
      run(
        process.execPath,
        [cli, "pack", Path.join(temporary, `${template}-again.tabsext`), "--json"],
        project,
        true,
      ),
    );
    assert.equal(again.digest, packed.digest);
    console.log(
      `${template}: standalone install/build/validate/pack/inspect/determinism passed (${packed.digest})`,
    );
    if (template === "react" && process.env.TABS_TUTORIAL_ELECTRON === "1") {
      run("node", ["apps/desktop/scripts/extension-smoke-test.mjs"], repository, false, {
        ...process.env,
        TABS_EXTENSION_SMOKE_STARTER: Path.join(project, ".tabs-extension"),
        TABS_EXTENSION_SMOKE_API_VERSION: version,
      });
    }
  }
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  // Only the unique temporary directory created above is removed.
  FS.rmSync(temporary, { recursive: true, force: true });
}
