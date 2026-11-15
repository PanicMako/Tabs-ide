/**
 * Internal routes the desktop host calls on behalf of an extension, after it
 * has checked the extension's capability and per-project grant: a read-only
 * project file and the project's Git branch/dirty state.
 *
 * Only the local desktop process can use them: loopback connections only, and
 * the per-launch token the desktop handed this server at startup. The project
 * root always comes from the server's own read model, never from the request,
 * and the shared helpers refuse paths that escape it.
 */
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { readExtensionGitStatus } from "./extensionGitStatus.ts";
import { readExtensionWorkspaceFile } from "./extensionWorkspaceRead.ts";
import { ProjectionSnapshotQuery } from "./orchestration-v2/ProjectionSnapshotQuery.ts";

export const EXTENSION_READ_PROJECT_FILE_PATH = "/internal/extensions/read-project-file";
export const EXTENSION_GIT_STATUS_PATH = "/internal/extensions/git-status";
const MAX_BODY_BYTES = 8 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function remoteAddress(request: HttpServerRequest.HttpServerRequest): string | undefined {
  const source = request.source as
    | { readonly socket?: { readonly remoteAddress?: string | null } }
    | undefined;
  const fromRequest = Option.getOrUndefined(request.remoteAddress);
  return source?.socket?.remoteAddress ?? fromRequest ?? undefined;
}

/** Constant-time comparison of the presented token with the expected one. */
export function backendTokenMatches(presented: unknown, expected: string | undefined): boolean {
  if (!expected || typeof presented !== "string") return false;
  const actual = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && NodeCrypto.timingSafeEqual(actual, wanted);
}

const json = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

/** Exported for tests; served by `layer` below. */
export const handleExtensionBrokerRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  const expected = config.desktopBootstrapToken ?? config.authToken;
  const address = remoteAddress(request);
  // Look like a missing route to anything that is not the local desktop.
  if (!expected || !address || !LOOPBACK.has(address)) return json(404, { error: "Not found." });
  if (!backendTokenMatches(request.headers["x-tabs-backend-token"], expected)) {
    return json(401, { error: "Unauthorized." });
  }
  const url = HttpServerRequest.toURL(request);
  const path = Option.isSome(url) ? url.value.pathname : "";
  const length = Number(request.headers["content-length"] ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
    return json(413, { error: "Request is too large." });
  }
  const body = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid request." });
  }
  if (typeof input.projectId !== "string" || !input.projectId) {
    return json(400, { error: "Invalid request." });
  }
  const snapshot = yield* (yield* ProjectionSnapshotQuery).getSnapshot();
  const project = snapshot.projects.find(
    (candidate) => candidate.id === input.projectId && candidate.deletedAt === null,
  );
  if (!project) return json(404, { error: "Project not found." });

  if (path === EXTENSION_GIT_STATUS_PATH) {
    return yield* Effect.tryPromise(() => readExtensionGitStatus(project.workspaceRoot)).pipe(
      Effect.map((status) => json(200, status)),
      Effect.orElseSucceed(() =>
        json(400, { error: "Git status is unavailable for this project." }),
      ),
    );
  }
  if (typeof input.relativePath !== "string") return json(400, { error: "Invalid request." });
  const relativePath = input.relativePath;
  return yield* Effect.tryPromise(() =>
    readExtensionWorkspaceFile(project.workspaceRoot, relativePath),
  ).pipe(
    Effect.map((contents) => json(200, { contents })),
    Effect.orElseSucceed(() => json(400, { error: "Workspace file is unavailable." })),
  );
}).pipe(Effect.orElseSucceed(() => json(500, { error: "Extension broker failed." })));

export const layer = HttpRouter.add("POST", "/internal/extensions/*", handleExtensionBrokerRequest);
