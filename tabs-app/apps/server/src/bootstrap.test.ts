import * as NFS from "node:fs";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FileSystem, Schema } from "effect";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import { readBootstrapEnvelope, resolveFdPath } from "./bootstrap";
import { assertNone, assertSome } from "@effect/vitest/utils";

const TestEnvelopeSchema = Schema.Struct({ mode: Schema.String });

it.layer(NodeServices.layer)("readBootstrapEnvelope", (it) => {
  it.effect("uses platform-specific fd paths", () =>
    Effect.sync(() => {
      assert.equal(resolveFdPath(3, "linux"), "/proc/self/fd/3");
      assert.equal(resolveFdPath(3, "darwin"), "/dev/fd/3");
      assert.equal(resolveFdPath(3, "win32"), undefined);
    }),
  );

  it.effect("reads a bootstrap envelope from a provided fd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const filePath = yield* fs.makeTempFileScoped({
        prefix: "tabs-bootstrap-",
        suffix: ".ndjson",
      });

      yield* fs.writeFileString(
        filePath,
        `${yield* Schema.encodeEffect(Schema.fromJsonString(TestEnvelopeSchema))({
          mode: "desktop",
        })}\n`,
      );

      const fd = yield* Effect.acquireRelease(
        Effect.sync(() => NFS.openSync(filePath, "r")),
        (fd) => Effect.sync(() => NFS.closeSync(fd)),
      );

      const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
      assertSome(payload, {
        mode: "desktop",
      });
    }),
  );

  it("reads a bootstrap envelope from a real child-process pipe", async () => {
    const childSource = `
      import { readBootstrapEnvelope } from './src/bootstrap.ts';
      import * as Effect from 'effect/Effect';
      import * as Option from 'effect/Option';
      import * as Schema from 'effect/Schema';

      const envelope = await Effect.runPromise(
        readBootstrapEnvelope(Schema.Struct({ mode: Schema.String }), 3, { timeoutMs: 1000 }),
      );
      if (Option.isNone(envelope) || envelope.value.mode !== 'desktop') {
        throw new Error('Child did not receive the bootstrap envelope.');
      }
      console.log('Child-process bootstrap pipe passed.');
    `;
    const child = spawn(
      "node",
      ["--experimental-strip-types", "--input-type=module", "-e", childSource],
      {
        cwd: path.resolve(fileURLToPath(new URL(".", import.meta.url)), ".."),
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      },
    );
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    const bootstrapPipe = child.stdio[3];
    if (!stdoutStream || !stderrStream || !bootstrapPipe || !("end" in bootstrapPipe)) {
      child.kill("SIGKILL");
      throw new Error("Child process did not expose the expected stdio pipes.");
    }
    let stdout = "";
    let stderr = "";
    stdoutStream.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    stderrStream.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    bootstrapPipe.on("error", (error) => {
      stderr += `Bootstrap pipe error: ${error.message}\n`;
    });
    bootstrapPipe.end('{"mode":"desktop"}\n');

    const exit = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Child-process bootstrap test timed out."));
        }, 5000).unref();
      }),
    ]);

    assert.equal(exit.code, 0, `Child bootstrap failed (${exit.signal}): ${stderr}`);
    assert.include(stdout, "Child-process bootstrap pipe passed.");
  }, 10_000);

  it.effect("returns none when the fd is unavailable", () =>
    Effect.gen(function* () {
      const fd = NFS.openSync("/dev/null", "r");
      NFS.closeSync(fd);

      const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
      assertNone(payload);
    }),
  );

  it.effect("returns none when the bootstrap read times out before any value arrives", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-bootstrap-" });
      const fifoPath = path.join(tempDir, "bootstrap.pipe");

      yield* Effect.sync(() => execFileSync("mkfifo", [fifoPath]));

      const _writer = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn("sh", ["-c", 'exec 3>"$1"; sleep 60', "sh", fifoPath], {
            stdio: ["ignore", "ignore", "ignore"],
          }),
        ),
        (writer) =>
          Effect.sync(() => {
            writer.kill("SIGKILL");
          }),
      );

      const fd = yield* Effect.acquireRelease(
        Effect.sync(() => NFS.openSync(fifoPath, "r")),
        (fd) => Effect.sync(() => NFS.closeSync(fd)),
      );

      const fiber = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, {
        timeoutMs: 100,
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(100));

      const payload = yield* Fiber.join(fiber);
      assertNone(payload);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
