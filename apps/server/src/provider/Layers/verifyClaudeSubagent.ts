import { Effect, Fiber, Stream, Layer, Context } from "effect";
import { FileSystem } from "effect";
import { makeClaudeAdapter } from "./ClaudeAdapter.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

async function main() {
  console.log("Starting ClaudeSubagentRun verification...");

  // Mock a Claude Query instance
  class FakeClaudeQuery {
    queue: any[] = [];
    waiters: any[] = [];

    emit(event: any) {
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        waiter.resolve({ done: false, value: event });
      } else {
        this.queue.push(event);
      }
    }

    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (this.queue.length > 0) {
            return Promise.resolve({ done: false, value: this.queue.shift() });
          }
          return new Promise((resolve) => {
            this.waiters.push({ resolve });
          });
        },
      };
    }

    close() {}
    async setModel() {}
    async setPermissionMode() {}
  }

  const query = new FakeClaudeQuery();

  const program = Effect.gen(function* () {
    const adapter = yield* (makeClaudeAdapter as any)({
      createQuery: () => query as any,
    });

    const eventsFiber = yield* Stream.take(adapter.streamEvents, 4).pipe(
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* adapter.startSession({
      threadId: "thread-claude-test" as any,
      provider: "claudeAgent" as any,
      runtimeMode: "full-access",
    });

    // 1. Send the TaskCreate tool_use
    query.emit({
      type: "message_start",
      message: {
        id: "msg_123",
        content: [],
        model: "claude-3-5-sonnet",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    });

    query.emit({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tu_subagent_123",
        name: "Task",
        input: {},
      },
    });

    // 2. Claude agent emits task_progress for this subagent
    query.emit({
      type: "system",
      subtype: "task_progress",
      task_id: "task-123",
      description: "Doing subagent work",
      summary: "Progress...",
      usage: { total_tokens: 10, tool_uses: 1, duration_ms: 100 },
      session_id: "sess_123",
      uuid: "evt_123",
    });

    // 3. Close the tool_use (meaning task is spawned/running? No, in Claude CLI, task progress happens after tool_use is emitted)
    query.emit({
      type: "content_block_stop",
      index: 0,
    });

    // Wait for the adapter to process the events
    const runtimeEvents = yield* Fiber.join(eventsFiber);

    console.log("Captured Runtime Events:");
    for (const evt of runtimeEvents as any) {
      console.log(` - ${evt.type} (ref: ${evt.providerThreadRef})`);
    }

    console.log("Subagent lifecycle verification completed!");
  });

  const layer = Layer.mergeAll(
    ServerConfig.layerTest("/tmp/test", "/tmp"),
    ServerSettingsService.layerTest(),
    Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.FileSystem.of({
        access: () => Effect.void,
        copy: () => Effect.void,
        copyFile: () => Effect.void,
        chmod: () => Effect.void,
        chown: () => Effect.void,
        exists: () => Effect.succeed(true),
        makeDirectory: () => Effect.void,
        makeTempDirectory: () => Effect.succeed("/tmp/dir"),
        makeTempDirectoryScoped: () => Effect.succeed("/tmp/dir"),
        makeTempFile: () => Effect.succeed("/tmp/file"),
        makeTempFileScoped: () => Effect.succeed("/tmp/file"),
        readDirectory: () => Effect.succeed([]),
        readFile: () => Effect.succeed(new Uint8Array(0)),
        readFileString: () => Effect.succeed(""),
        realPath: (p: string) => Effect.succeed(p),
        remove: () => Effect.void,
        rename: () => Effect.void,
        stat: () =>
          Effect.succeed({
            type: "File",
            size: 0,
            mtime: new Date(),
            atime: new Date(),
            ctime: new Date(),
            birthtime: new Date(),
            dev: 0,
            ino: 0,
            mode: 0,
            nlink: 0,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 0,
            blocks: 0,
          } as any),
        symlink: () => Effect.void,
        truncate: () => Effect.void,
        utimes: () => Effect.void,
        watch: () => Stream.empty,
        writeFile: () => Effect.void,
        writeFileString: () => Effect.void,
        readLink: () => Effect.succeed(""),
        link: () => Effect.void,
      } as any),
    ),
  );

  await Effect.runPromise(program.pipe(Effect.provide(layer)) as any);
}

main().catch(console.error);
