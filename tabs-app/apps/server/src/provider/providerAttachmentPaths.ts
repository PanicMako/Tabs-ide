// FILE: providerAttachmentPaths.ts
// Purpose: Resolves persisted attachment identities to provider-readable storage paths.
// Layer: Orchestration/provider boundary utility
// Depends on: managed attachment persistence and the legacy attachment layout.

import { statSync } from "node:fs";

import {
  type ChatAttachment,
  CanonicalItemType,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ProviderAdapterValidationError } from "./Errors.ts";

export interface ManagedAttachmentBlob {
  readonly attachmentId: string;
  readonly ownerThreadId: string;
  readonly ownerKind: string;
  readonly ownerId: string;
  readonly kind: "image" | "file";
  readonly originalName: string;
  readonly mimeType: string;
  readonly reservedBytes: number;
  readonly sizeBytes: number | null;
  readonly sha256: string;
  readonly relativePath: string;
  readonly state: string;
  readonly claimMessageId?: string | null;
  readonly [key: string]: unknown;
}

export interface ManagedAttachmentRepositoryShape {
  readonly findClaimedById: (input: {
    readonly attachmentId: string;
  }) => Effect.Effect<Option.Option<ManagedAttachmentBlob>, unknown>;
}

const MANAGED_ATTACHMENT_ID_PATTERN = /^att_v2_[0-9a-f]{32}$/u;
const PROVIDER_ATTACHMENT_STORAGE_PATH = Symbol("synara.providerAttachmentStoragePath");

type ProviderResolvedAttachment = ChatAttachment & {
  readonly [PROVIDER_ATTACHMENT_STORAGE_PATH]?: string;
};

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function markedStoragePath(attachment: unknown): string | null {
  if (typeof attachment !== "object" || attachment === null) {
    return null;
  }
  const storagePath = (attachment as ProviderResolvedAttachment)[PROVIDER_ATTACHMENT_STORAGE_PATH];
  return typeof storagePath === "string" && storagePath.length > 0 ? storagePath : null;
}

function withStoragePath(attachment: ChatAttachment, storagePath: string): ChatAttachment {
  const resolved = { ...attachment } as ProviderResolvedAttachment;
  Object.defineProperty(resolved, PROVIDER_ATTACHMENT_STORAGE_PATH, {
    configurable: false,
    enumerable: false,
    value: storagePath,
    writable: false,
  });
  return resolved;
}

function resolutionError(input: {
  readonly provider: ProviderDriverKind | string;
  readonly operation: string;
  readonly attachmentId: string;
}): ProviderAdapterValidationError {
  return new ProviderAdapterValidationError({
    provider: input.provider,
    operation: input.operation,
    issue: `Attachment '${input.attachmentId}' is unavailable for this message. Reattach the file and retry.`,
  });
}

/** Resolve an attachment already normalized for provider dispatch, falling back to the legacy layout. */
export function resolveProviderAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return (
    markedStoragePath(input.attachment) ??
    resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment: input.attachment,
    })
  );
}

/**
 * Schema decoding intentionally drops server-only properties. Carry only the
 * unforgeable in-process storage marker from the validated raw input to the
 * decoded attachment objects before adapter dispatch.
 */
export function carryProviderAttachmentPaths(
  rawInput: unknown,
  attachments: ReadonlyArray<ChatAttachment>,
): ChatAttachment[] {
  const rawAttachments =
    typeof rawInput === "object" &&
    rawInput !== null &&
    "attachments" in rawInput &&
    Array.isArray((rawInput as { readonly attachments?: unknown }).attachments)
      ? (rawInput as { readonly attachments: ReadonlyArray<unknown> }).attachments
      : [];

  return attachments.map((attachment, index) => {
    const storagePath = markedStoragePath(rawAttachments[index]);
    return storagePath ? withStoragePath(attachment, storagePath) : attachment;
  });
}

/**
 * Resolve managed attachments through their claimed repository record exactly
 * once at the orchestration/provider boundary. Legacy IDs retain their
 * historical flat-file resolution.
 */
export function resolveProviderDispatchAttachments(input: {
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly attachmentsDir: string;
  readonly repository: Pick<ManagedAttachmentRepositoryShape, "findClaimedById">;
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly provider: ProviderDriverKind | string;
  readonly operation: string;
}): Effect.Effect<ReadonlyArray<ChatAttachment>, ProviderAdapterValidationError> {
  return Effect.forEach(
    input.attachments ?? [],
    (attachment: any) => {
      if (attachment.type === "assistant-selection") {
        return Effect.succeed<ChatAttachment>(attachment);
      }

      const existingStoragePath = markedStoragePath(attachment);
      if (existingStoragePath) {
        return isRegularFile(existingStoragePath)
          ? Effect.succeed<ChatAttachment>(attachment)
          : Effect.fail(
              resolutionError({
                provider: input.provider,
                operation: input.operation,
                attachmentId: attachment.id,
              }),
            );
      }

      if (!MANAGED_ATTACHMENT_ID_PATTERN.test(attachment.id)) {
        const legacyPath = resolveAttachmentPath({
          attachmentsDir: input.attachmentsDir,
          attachment,
        });
        return legacyPath && isRegularFile(legacyPath)
          ? Effect.succeed(withStoragePath(attachment, legacyPath))
          : Effect.fail(
              resolutionError({
                provider: input.provider,
                operation: input.operation,
                attachmentId: attachment.id,
              }),
            );
      }

      return input.repository.findClaimedById({ attachmentId: attachment.id }).pipe(
        Effect.mapError(() =>
          resolutionError({
            provider: input.provider,
            operation: input.operation,
            attachmentId: attachment.id,
          }),
        ),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                resolutionError({
                  provider: input.provider,
                  operation: input.operation,
                  attachmentId: attachment.id,
                }),
              ),
            onSome: (blob: any) => {
              const storagePath = resolveAttachmentRelativePath({
                attachmentsDir: input.attachmentsDir,
                relativePath: blob.relativePath,
              });
              const isAuthorizedClaim =
                blob.state === "claimed" &&
                blob.ownerThreadId === input.threadId &&
                blob.claimMessageId === input.messageId;
              const isCompatibleBlob =
                (blob.kind === "image" || blob.kind === "file") &&
                blob.kind === attachment.type &&
                blob.sizeBytes !== null;
              if (
                !isAuthorizedClaim ||
                !isCompatibleBlob ||
                !storagePath ||
                !isRegularFile(storagePath)
              ) {
                return Effect.fail(
                  resolutionError({
                    provider: input.provider,
                    operation: input.operation,
                    attachmentId: attachment.id,
                  }),
                );
              }

              return Effect.succeed<ChatAttachment>(
                withStoragePath(
                  {
                    type: blob.kind,
                    id: blob.attachmentId,
                    name: blob.originalName,
                    mimeType: blob.mimeType,
                    sizeBytes: blob.sizeBytes,
                  },
                  storagePath,
                ),
              );
            },
          }),
        ),
      );
    },
    { concurrency: 1 },
  );
}
