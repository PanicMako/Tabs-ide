// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ChatAttachmentId, ThreadId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Management from "./ThreadManagementService.ts";
import { sendToThread } from "./ThreadMessageIntake.ts";
const layer = ServerConfig.layerTest(process.cwd(), { prefix: "intake-rejection-audit-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
for (const reason of ["archived", "no-steerable-run"] as const) {
  it.effect(`releases unused copies after known pre-dispatch rejection: ${reason}`, () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const threadId = ThreadId.make("thread-rejection-audit");
      const id = ChatAttachmentId.make(createPendingAttachmentId()!);
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `${id}.png`),
        Buffer.from([1, 2, 3]),
      );
      const failure =
        reason === "archived"
          ? new Management.ThreadManagementThreadArchivedError({ threadId })
          : new Management.ThreadManagementNoSteerableRunError({ threadId, mode: "steer" });
      const result = yield* sendToThread({
        threadId,
        attachments: [{ type: "image", id, name: "test.png", mimeType: "image/png", sizeBytes: 3 }],
      } as never).pipe(
        Effect.provide(
          Layer.mock(Management.ThreadManagementService)({
            sendToThread: () => Effect.fail(failure),
          }),
        ),
        Effect.result,
      );
      expect(result._tag).toBe("Failure");
      expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${id}.png`))).toBe(true);
      expect(
        NodeFS.readdirSync(config.attachmentsDir).filter((name) =>
          name.startsWith("thread-rejection-audit-"),
        ),
      ).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );
}
