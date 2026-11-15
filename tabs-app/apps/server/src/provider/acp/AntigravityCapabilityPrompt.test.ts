import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ChatAttachment } from "@tabs/contracts";
import { HostProcessPlatform } from "@tabs/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { buildAntigravityCapabilityPrompt } from "./AntigravityAcpSupport.ts";

const imageAttachment = {
  type: "image",
  id: "thread-00000000-0000-4000-8000-000000000001",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 1,
} satisfies ChatAttachment;

const textAttachment = {
  type: "file",
  id: "thread-00000000-0000-4000-8000-000000000002-tsx",
  name: "example.tsx",
  mimeType: "application/octet-stream",
  sizeBytes: 1,
} satisfies ChatAttachment;

const pdfAttachment = {
  type: "file",
  id: "thread-00000000-0000-4000-8000-000000000003-pdf",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
} satisfies ChatAttachment;

const makeAttachmentFixture = Effect.fn("AntigravityAcpSupportTest.makeAttachmentFixture")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const attachmentsDir = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-antigravity-attachments-",
    });
    const write = Effect.fn("AntigravityAcpSupportTest.writeAttachment")(function* (
      attachment: ChatAttachment,
      content: string | Uint8Array,
    ) {
      const filePath = resolveAttachmentPath({ attachmentsDir, attachment });
      if (filePath === null) throw new Error("Invalid test attachment path.");
      if (typeof content === "string") yield* fs.writeFileString(filePath, content);
      else yield* fs.writeFile(filePath, content);
      return { filePath, uri: (yield* path.toFileUrl(filePath)).href };
    });
    const resolve = (attachment: ChatAttachment) =>
      resolveAttachmentPath({ attachmentsDir, attachment });
    return { fs, attachmentsDir, resolve, write };
  },
);

it.layer(NodeServices.layer)("buildAntigravityCapabilityPrompt", (it) => {
  it.effect("sends image bytes as native image content alongside the user prompt", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=",
        "base64",
      );
      yield* fixture.write(imageAttachment, bytes);
      const prompt = yield* buildAntigravityCapabilityPrompt({
        input: "  Explain this image.  ",
        attachments: [imageAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      });

      expect(prompt).toEqual([
        { type: "text", text: "Explain this image." },
        { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
      ]);
    }),
  );

  it.effect("embeds UTF-8 code from the selected environment and keeps the upload in place", () =>
    Effect.gen(function* () {
      const selectedEnvironment = yield* makeAttachmentFixture();
      const otherEnvironment = yield* makeAttachmentFixture();
      const source = '  const name = "caf\u00e9";\n';
      const upload = yield* selectedEnvironment.write(textAttachment, source);
      yield* otherEnvironment.write(textAttachment, "Different environment.");
      const prompt = yield* buildAntigravityCapabilityPrompt({
        input: undefined,
        attachments: [textAttachment],
        resolveAttachmentPath: selectedEnvironment.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      });

      expect(prompt).toEqual([
        {
          type: "resource",
          resource: { uri: upload.uri, mimeType: "application/octet-stream", text: source },
        },
      ]);
      expect(yield* selectedEnvironment.fs.readFileString(upload.filePath)).toBe(source);
      expect(
        yield* selectedEnvironment.fs.readDirectory(selectedEnvironment.attachmentsDir),
      ).toHaveLength(1);
    }),
  );

  it.effect("keeps folded clipboard text out of native context", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const pastedText = {
        ...textAttachment,
        name: "pasted-text.txt",
        mimeType: "text/plain",
        source: { _tag: "pasted-text" as const },
      } satisfies ChatAttachment;
      yield* fixture.write(pastedText, "A very large crash report");

      const prompt = yield* buildAntigravityCapabilityPrompt({
        input: "Inspect the pasted text only as needed.",
        attachments: [pastedText],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      });

      expect(prompt).toEqual([{ type: "text", text: "Inspect the pasted text only as needed." }]);
    }),
  );

  it.effect.each([
    { name: "archive.zip", mimeType: "application/zip" },
    { name: "clip.mp4", mimeType: "video/mp4" },
    { name: "recording.aiff", mimeType: "audio/aiff" },
    { name: "large.pdf", mimeType: "application/pdf", sizeBytes: 75_000_000 },
    { name: "large.txt", mimeType: "text/plain", sizeBytes: 1024 * 1024 + 1 },
    { name: "large.wav", mimeType: "audio/wav", sizeBytes: 20 * 1024 * 1024 + 1 },
  ])("keeps $name as a file path without reading or spending the native media budget", (file) =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const attachment = { ...textAttachment, sizeBytes: 50 * 1024 * 1024, ...file };
      const upload = yield* fixture.write(attachment, "");
      yield* fixture.fs.truncate(upload.filePath, attachment.sizeBytes);
      const pdf = yield* fixture.write(pdfAttachment, "");
      yield* fixture.fs.truncate(pdf.filePath, 50 * 1024 * 1024);
      const input = `Inspect the file at ${upload.filePath}`;
      const prompt = yield* buildAntigravityCapabilityPrompt({
        input,
        attachments: [attachment, pdfAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fixture.fs,
          stream: () => {
            throw new Error("Path attachments must not be read into the prompt");
          },
        }),
      );
      expect(prompt).toEqual([
        { type: "text", text: input },
        {
          type: "resource_link",
          uri: pdf.uri,
          name: "report.pdf",
          mimeType: "application/pdf",
          size: 50 * 1024 * 1024,
        },
      ]);
    }),
  );

  it.effect.each([
    {
      case: "a Gemini model id",
      model: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      linked: true,
    },
    {
      case: "an opaque id named Gemini",
      model: { id: "agy-model", name: "Gemini 4 Carbon" },
      linked: true,
    },
    { case: "an unknown model", model: { id: "agy-custom", name: "Custom" }, linked: false },
    { case: "an unlisted opaque id", model: { id: "agy-custom", name: undefined }, linked: false },
    { case: "an unresolved model", model: undefined, linked: false },
    {
      case: "a Claude model",
      model: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      linked: false,
    },
    {
      case: "an unqualified runtime",
      agentVersion: "1.4.1",
      model: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      linked: false,
    },
    {
      case: "a Windows host",
      platform: "win32" as const,
      model: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      linked: false,
    },
    {
      case: "a clip over 20 MiB",
      model: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      linked: false,
      sizeBytes: 20 * 1024 * 1024 + 1,
    },
  ])(
    "links an MP4 for $case only when supported",
    ({ agentVersion = "1.4.5", platform = "linux", model, linked, ...size }) =>
      Effect.gen(function* () {
        const fixture = yield* makeAttachmentFixture();
        const clip = {
          ...textAttachment,
          id: "clip",
          name: "clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 6 * 1024 * 1024,
          ...size,
        };
        const upload = yield* fixture.write(clip, "");
        yield* fixture.fs.truncate(upload.filePath, clip.sizeBytes);
        const prompt = yield* buildAntigravityCapabilityPrompt({
          input: "What colors appear?",
          attachments: [clip],
          resolveAttachmentPath: fixture.resolve,
          promptCapabilities: { image: true, audio: true, embeddedContext: true },
          agentVersion,
          currentModel: model,
        }).pipe(
          Effect.provideService(HostProcessPlatform, platform),
          Effect.provideService(FileSystem.FileSystem, {
            ...fixture.fs,
            stream: () => Effect.die("Linked video is read by the agent").pipe(Stream.fromEffect),
          }),
        );
        expect(prompt).toEqual([
          { type: "text", text: "What colors appear?" },
          ...(linked
            ? [
                {
                  type: "resource_link",
                  uri: upload.uri,
                  name: "clip.mp4",
                  mimeType: "video/mp4",
                  size: clip.sizeBytes,
                },
              ]
            : []),
        ]);
      }),
  );

  it.effect.each([undefined, {}, { image: false, audio: false, embeddedContext: false }])(
    "keeps attachments path-only when native prompt capabilities are absent: %s",
    (promptCapabilities) =>
      Effect.gen(function* () {
        const fixture = yield* makeAttachmentFixture();
        const audio = {
          ...textAttachment,
          id: "unsupported-audio",
          name: "audio.wav",
          mimeType: "audio/wav",
        };
        const gifAttachment = {
          ...imageAttachment,
          id: "unsupported-gif",
          name: "animation.gif",
          mimeType: "image/gif",
        };
        const gif = yield* fixture.write(gifAttachment, "GIF89a");
        const image = yield* fixture.write(imageAttachment, "pixels");
        const pdf = yield* fixture.write(pdfAttachment, "%PDF-1.7");
        const text = yield* fixture.write(textAttachment, "hello");
        const sound = yield* fixture.write(audio, "RIFF");
        const input = `Read ${image.filePath}, ${gif.filePath}, ${pdf.filePath}, ${text.filePath}, and ${sound.filePath}`;
        const prompt = yield* buildAntigravityCapabilityPrompt({
          input,
          attachments: [imageAttachment, gifAttachment, pdfAttachment, textAttachment, audio],
          resolveAttachmentPath: fixture.resolve,
          promptCapabilities,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fixture.fs,
            stream: () =>
              Effect.die("Unnegotiated attachments must not be read").pipe(Stream.fromEffect),
          }),
        );
        expect(prompt).toEqual([{ type: "text", text: input }]);
        expect(
          yield* buildAntigravityCapabilityPrompt({
            input: "Continue",
            attachments: [],
            resolveAttachmentPath: fixture.resolve,
            promptCapabilities,
          }),
        ).toEqual([{ type: "text", text: "Continue" }]);
      }),
  );

  it.effect("sends supported audio files as native audio content", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const audioAttachment = {
        ...textAttachment,
        id: "recording-1",
        name: "recording.wav",
        mimeType: "audio/wav",
      } satisfies ChatAttachment;
      const bytes = Buffer.from("RIFF....WAVEfmt ", "latin1");
      yield* fixture.write(audioAttachment, bytes);
      const prompt = yield* buildAntigravityCapabilityPrompt({
        input: "Transcribe this.",
        attachments: [audioAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      });

      expect(prompt).toEqual([
        { type: "text", text: "Transcribe this." },
        { type: "audio", data: bytes.toString("base64"), mimeType: "audio/wav" },
      ]);
    }),
  );

  it.effect.each([{ image: true }])(
    "keeps unsupported image formats path-only with capabilities %s",
    (promptCapabilities) =>
      Effect.gen(function* () {
        const fixture = yield* makeAttachmentFixture();
        const attachment = { ...imageAttachment, name: "animation.gif", mimeType: "image/gif" };
        const upload = yield* fixture.write(attachment, "GIF89a");
        const input = `Analyze the image at ${upload.filePath}`;
        const prompt = yield* buildAntigravityCapabilityPrompt({
          input,
          attachments: [attachment],
          resolveAttachmentPath: fixture.resolve,
          promptCapabilities,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fixture.fs,
            stream: () => Effect.die("Unsupported images must not be read").pipe(Stream.fromEffect),
          }),
        );

        expect(prompt).toEqual([{ type: "text", text: input }]);
      }),
  );

  it.effect("rejects oversized images using file size instead of upload metadata", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const upload = yield* fixture.write(imageAttachment, "");
      yield* fixture.fs.truncate(upload.filePath, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1);
      const error = yield* buildAntigravityCapabilityPrompt({
        input: "Read this attachment.",
        attachments: [imageAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: expect.stringContaining("'screen.png' is too large"),
      });
    }),
  );

  it.effect("keeps PDF overflow on the file-path route", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const secondAttachment = {
        ...pdfAttachment,
        id: `${pdfAttachment.id}-second`,
        name: "second.pdf",
      };
      const first = yield* fixture.write(pdfAttachment, "");
      const second = yield* fixture.write(secondAttachment, "");
      yield* fixture.fs.truncate(first.filePath, (50 * 1024 * 1024) / 2);
      yield* fixture.fs.truncate(second.filePath, (50 * 1024 * 1024) / 2);
      const input = {
        input: `Read ${first.filePath} and ${second.filePath}`,
        attachments: [pdfAttachment, secondAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      };
      const prompt = yield* buildAntigravityCapabilityPrompt(input);
      expect(prompt).toEqual([
        { type: "text", text: input.input },
        {
          type: "resource_link",
          uri: first.uri,
          name: "report.pdf",
          mimeType: "application/pdf",
          size: (50 * 1024 * 1024) / 2,
        },
        {
          type: "resource_link",
          uri: second.uri,
          name: "second.pdf",
          mimeType: "application/pdf",
          size: (50 * 1024 * 1024) / 2,
        },
      ]);

      yield* fixture.fs.truncate(second.filePath, (50 * 1024 * 1024) / 2 + 1);
      expect(yield* buildAntigravityCapabilityPrompt(input)).toEqual([
        { type: "text", text: input.input },
        {
          type: "resource_link",
          uri: first.uri,
          name: "report.pdf",
          mimeType: "application/pdf",
          size: (50 * 1024 * 1024) / 2,
        },
      ]);
    }),
  );

  it.effect("still rejects images when the native budget is full", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const pdf = yield* fixture.write(pdfAttachment, "");
      yield* fixture.fs.truncate(pdf.filePath, 50 * 1024 * 1024);
      yield* fixture.write(imageAttachment, new Uint8Array([1]));
      const error = yield* buildAntigravityCapabilityPrompt({
        input: "Inspect both attachments.",
        attachments: [pdfAttachment, imageAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        errorMessage: expect.stringContaining("'screen.png' is too large"),
      });
    }),
  );

  it.effect("rejects aggregate overflow when a text upload grows after its size check", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const pdf = yield* fixture.write(pdfAttachment, "");
      const text = yield* fixture.write(textAttachment, "a");
      yield* fixture.fs.truncate(pdf.filePath, 50 * 1024 * 1024 - 1);
      const error = yield* buildAntigravityCapabilityPrompt({
        input: undefined,
        attachments: [pdfAttachment, textAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fixture.fs,
          stat: Effect.fn("AntigravityAcpSupportTest.growAfterStat")(function* (filePath: string) {
            const info = yield* fixture.fs.stat(filePath);
            if (filePath === text.filePath) {
              yield* fixture.fs.writeFileString(filePath, "ab");
            }
            return info;
          }),
        }),
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: "Attachment 'example.tsx' changed while being read and is too large.",
      });
    }),
  );

  it.effect.each([
    { bytes: new Uint8Array([0xff, 0xfe, 0x61]), message: "is not a UTF-8 text file" },
    { bytes: new Uint8Array([0x61, 0, 0x62]), message: "contains binary data" },
  ])("rejects binary data disguised as code: $message", ({ bytes, message }) =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      yield* fixture.write(textAttachment, bytes);
      const error = yield* buildAntigravityCapabilityPrompt({
        input: undefined,
        attachments: [textAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: expect.stringContaining(message),
      });
    }),
  );

  it.effect("reports a missing upload instead of sending only the remaining text", () =>
    Effect.gen(function* () {
      const fixture = yield* makeAttachmentFixture();
      const error = yield* buildAntigravityCapabilityPrompt({
        input: "Read this image.",
        attachments: [imageAttachment],
        resolveAttachmentPath: fixture.resolve,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
      }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "AcpRequestError",
        code: -32602,
        errorMessage: "Could not read attachment 'screen.png'.",
      });
    }),
  );
});
