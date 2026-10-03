import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
} from "@tabs/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES,
  antigravityPermissionMode,
  applyAntigravityAcpModelSelection,
  buildAntigravityPrompt,
} from "./AntigravityAcpSupport";
import { resolveAttachmentPath } from "../../attachmentStore";

const modelConfig = {
  id: "model",
  name: "Model",
  type: "select",
  currentValue: "gemini-default",
  options: [
    { value: "gemini-default", name: "Gemini default" },
    { value: "gemini-saved", name: "Gemini saved" },
  ],
} satisfies EffectAcpSchema.SessionConfigOption;

function makeRuntime(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [modelConfig],
  failure?: EffectAcpErrors.AcpError,
) {
  const selections: string[] = [];
  return {
    selections,
    runtime: {
      getConfigOptions: Effect.succeed(configOptions),
      setModel: (model: string) =>
        failure
          ? Effect.fail(failure)
          : Effect.sync(() => {
              selections.push(model);
            }),
    },
  };
}

describe("Antigravity ACP support", () => {
  it("maps Tabs permissions to native Antigravity modes", () => {
    expect(antigravityPermissionMode("approval-required")).toBe("default");
    expect(antigravityPermissionMode("auto-accept-edits")).toBe("auto_edit");
    expect(antigravityPermissionMode("full-access")).toBe("yolo");
  });

  it.effect("restores a saved native model after resume", () =>
    Effect.gen(function* () {
      const { runtime, selections } = makeRuntime();
      expect(
        yield* applyAntigravityAcpModelSelection({
          runtime,
          model: "gemini-saved",
          mapError: (cause) => cause,
        }),
      ).toBe("gemini-saved");
      expect(selections).toEqual(["gemini-saved"]);
    }),
  );

  it.effect("keeps the native default for the provider default alias", () =>
    Effect.gen(function* () {
      const { runtime, selections } = makeRuntime();
      expect(
        yield* applyAntigravityAcpModelSelection({
          runtime,
          model: ANTIGRAVITY_DEFAULT_MODEL,
          mapError: (cause) => cause,
        }),
      ).toBe("gemini-default");
      expect(selections).toEqual([]);
    }),
  );

  it.effect("rejects stale model IDs instead of silently selecting another model", () =>
    Effect.gen(function* () {
      const { runtime, selections } = makeRuntime();
      expect(
        yield* applyAntigravityAcpModelSelection({
          runtime,
          model: "gemini-removed",
          mapError: (cause) => cause,
        }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "AcpRequestError", code: -32602 });
      expect(selections).toEqual([]);
    }),
  );
});

const imageAttachment = {
  type: "image",
  id: "antigravity-image-1",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 1,
} satisfies ChatAttachment;

const textAttachment = {
  type: "file",
  id: "antigravity-text-1",
  name: "example.ts",
  mimeType: "application/octet-stream",
  sizeBytes: 1,
} satisfies ChatAttachment;

const pdfAttachment = {
  type: "file",
  id: "antigravity-pdf-1",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
} satisfies ChatAttachment;

const makeAttachmentFixture = Effect.fn("AntigravityAcpSupportTest.makeAttachmentFixture")(
  function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "tabs-antigravity-attachments-",
    });
    const write = Effect.fn("AntigravityAcpSupportTest.writeAttachment")(function* (
      attachment: ChatAttachment,
      content: string | Uint8Array,
    ) {
      const filePath = resolveAttachmentPath({ attachmentsDir, attachment });
      if (filePath === null) throw new Error("Invalid fixture attachment path.");
      if (typeof content === "string") yield* fileSystem.writeFileString(filePath, content);
      else yield* fileSystem.writeFile(filePath, content);
      return { filePath, uri: (yield* path.toFileUrl(filePath)).href };
    });
    return { fileSystem, attachmentsDir, write };
  },
);

it.layer(NodeServices.layer)("Antigravity native attachment prompts", (it) => {
  it.effect("encodes supported images without dropping the text prompt", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      yield* fixture.write(imageAttachment, bytes);
      expect(
        yield* buildAntigravityPrompt({
          input: "  Inspect this.  ",
          attachments: [imageAttachment],
          attachmentsDir: fixture.attachmentsDir,
        }),
      ).toEqual([
        { type: "text", text: "Inspect this." },
        { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" },
      ]);
    }),
  );

  it.effect("embeds validated UTF-8 text as an ACP resource", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const source = 'const greeting = "café";\n';
      const upload = yield* fixture.write(textAttachment, source);
      expect(
        yield* buildAntigravityPrompt({
          input: undefined,
          attachments: [textAttachment],
          attachmentsDir: fixture.attachmentsDir,
        }),
      ).toEqual([
        {
          type: "resource",
          resource: {
            uri: upload.uri,
            mimeType: "application/octet-stream",
            text: source,
          },
        },
      ]);
    }),
  );

  it.effect("passes PDFs by file resource link without buffering their contents", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const upload = yield* fixture.write(pdfAttachment, "%PDF-1.7\n");
      expect(
        yield* buildAntigravityPrompt({
          input: undefined,
          attachments: [pdfAttachment],
          attachmentsDir: fixture.attachmentsDir,
        }),
      ).toEqual([
        { type: "resource_link", uri: upload.uri, name: "report.pdf", mimeType: "application/pdf" },
      ]);
    }),
  );

  it.effect("rejects unsupported attachment types instead of silently dropping them", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const archive = {
        ...textAttachment,
        id: "antigravity-archive-1",
        name: "source.zip",
        mimeType: "application/zip",
      } satisfies ChatAttachment;
      yield* fixture.write(archive, new Uint8Array([1]));
      const error = yield* buildAntigravityPrompt({
        input: "Inspect every attachment.",
        attachments: [archive],
        attachmentsDir: fixture.attachmentsDir,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: expect.stringContaining("does not support 'source.zip'"),
      });
    }),
  );

  it.effect("enforces the real file size rather than trusting upload metadata", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const upload = yield* fixture.write(textAttachment, "");
      yield* fixture.fileSystem.truncate(
        upload.filePath,
        ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES + 1,
      );
      const error = yield* buildAntigravityPrompt({
        input: undefined,
        attachments: [textAttachment],
        attachmentsDir: fixture.attachmentsDir,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: expect.stringContaining("is too large"),
      });
      expect(ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES).toBeLessThan(
        PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
      );
    }),
  );

  it.effect("rejects an empty native turn", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const error = yield* buildAntigravityPrompt({
        input: "  ",
        attachments: [],
        attachmentsDir: fixture.attachmentsDir,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: "A turn requires text or supported attachments.",
      });
    }),
  );
});
