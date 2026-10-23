import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Explicit post-build integration gate. Ordinary unit tests use temporary fixtures.
const desktop = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(desktop, "../../../tabs-code-oss");
const temporary = await mkdtemp(join(tmpdir(), "tabs-codeoss-native-contract-"));
try {
  const entry = join(temporary, "adapters.ts");
  const bundle = join(temporary, "adapters.mjs");
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(join(desktop, "src/nativeCodeHostActivity.ts"))};`,
      `export * from ${JSON.stringify(join(desktop, "src/nativeCodeHostStorage.ts"))};`,
      `export * from ${JSON.stringify(join(desktop, "src/nativeCodeHostZip.ts"))};`,
    ].join("\n"),
  );
  const build = spawnSync(
    "bun",
    ["build", entry, "--target=node", "--format=esm", `--outfile=${bundle}`],
    { stdio: "inherit" },
  );
  if (build.error) throw build.error;
  assert.equal(build.status, 0, "Could not bundle the native contract adapters");
  const upstream = (path) => import(pathToFileURL(join(runtime, "out", path)).href);
  const [
    adapters,
    { AgentsWindowInvitationState },
    { URI },
    { CancellationTokenSource },
    { zip, validateZip },
  ] = await Promise.all([
    import(pathToFileURL(bundle).href),
    upstream("vs/platform/chat/common/agentsWindowInvitation.js"),
    upstream("vs/base/common/uri.js"),
    upstream("vs/base/common/cancellation.js"),
    upstream("vs/base/node/zip.js"),
  ]);
  const storagePath = join(temporary, "storage.json");
  const storage = new Map();
  const service = adapters.createNativeCodeHostStorageService(storage, () =>
    adapters.saveNativeCodeHostStorage(storagePath, storage),
  );
  const coordinator = new AgentsWindowInvitationState(Date.now, service);
  const events = [];
  const subscription = coordinator.onDidChange((state) => events.push(state));
  try {
    const activity = adapters.createNativeCodeHostActivity(coordinator, URI.revive, (id) =>
      id === 3 ? "agents" : id === 1 || id === 2 ? "editor" : undefined,
    );
    activity.initialize(7);
    const first = URI.parse("agent-host:/first").toJSON();
    const second = URI.parse("agent-host:/second").toJSON();
    activity.update(1, { kind: "request", resource: first, isNewSession: true });
    activity.update(1, { kind: "request", resource: first, isNewSession: true });
    assert.equal(
      activity.initialize(0).editorSessionCount,
      8,
      "Duplicate requests must not double count",
    );
    activity.update(1, {
      kind: "sessions",
      sessions: [{ resource: first, inProgress: true, needsInput: false }],
    });
    activity.update(2, {
      kind: "sessions",
      sessions: [{ resource: first, inProgress: false, needsInput: true }],
    });
    assert.equal(
      activity.initialize(0).sessions[0].inProgress,
      true,
      "Another editor must not overwrite activity",
    );
    assert.equal(activity.claim(2, first, true), undefined);
    const invitation = activity.claim(1, first, true);
    assert.ok(invitation);
    activity.markShown(1, invitation.id);
    assert.equal(activity.initialize(0).invitation.shown, true);
    activity.release(1, invitation.id);
    activity.update(1, { kind: "commit", original: first, committed: second });
    assert.equal(activity.initialize(0).sessions[0].resource.path, "/second");
    activity.update(1, { kind: "copilotHarnessIntroductionShown" });
    activity.update(3, { kind: "request", resource: second, isNewSession: true });
    assert.equal(
      activity.initialize(0).sessions.length,
      0,
      "Agents requests revoke editor ownership",
    );
    activity.update(1, { kind: "request", resource: first, isNewSession: true });
    activity.update(1, { kind: "delete", resources: [first] });
    assert.equal(activity.initialize(0).sessions.length, 0);
    activity.update(2, { kind: "request", resource: second, isNewSession: true });
    coordinator.resetWindow(2, false);
    assert.equal(activity.initialize(0).sessions.length, 0);
    assert.ok(events.length >= 10, "Coordinator must emit its changes");
    const restored = new AgentsWindowInvitationState(
      Date.now,
      adapters.createNativeCodeHostStorageService(
        adapters.loadNativeCodeHostStorage(storagePath),
        () => {},
      ),
    );
    try {
      const state = restored.initialize(0);
      assert.equal(state.editorSessionCount, 10);
      assert.equal(state.lastCopilotHarnessIntroductionSessionCount, 8);
    } finally {
      restored.dispose();
    }
  } finally {
    subscription.dispose();
    coordinator.dispose();
  }
  console.log(
    "PASS: real upstream agent coordinator, persistence, events, invitations and ownership",
  );

  const source = join(temporary, "large.bin");
  const destination = join(temporary, "cancelled.zip");
  await writeFile(source, Buffer.alloc(4 * 1024 * 1024, 7));
  let progress = 0;
  const operations = new adapters.NativeCodeZipOperations(
    zip,
    () => new CancellationTokenSource(),
    (event) => {
      assert.equal(event.total, 4 * 1024 * 1024);
      progress++;
      operations.cancel(1, event.operationId);
    },
  );
  try {
    await assert.rejects(
      operations.create(
        1,
        { fsPath: destination },
        [{ path: "large.bin", source: { fsPath: source }, size: 4 * 1024 * 1024, compress: false }],
        { operationId: "cancel" },
      ),
      { name: "Canceled" },
    );
    assert.ok(progress > 0);
    await assert.rejects(access(destination));
  } finally {
    operations.dispose();
  }
  const success = new adapters.NativeCodeZipOperations(
    zip,
    () => new CancellationTokenSource(),
    () => {},
  );
  try {
    const path = join(temporary, "success.zip");
    await success.create(1, { fsPath: path }, [{ path: "summary.txt", contents: "ok" }], {
      operationId: "success",
      maxEntries: 1,
      maxSize: 1024,
    });
    await validateZip(path, { maxEntries: 1, maxUncompressedSize: 1024 });
  } finally {
    success.dispose();
  }
  console.log(
    "PASS: real upstream ZIP streaming, cancellation, progress and partial-output cleanup",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
