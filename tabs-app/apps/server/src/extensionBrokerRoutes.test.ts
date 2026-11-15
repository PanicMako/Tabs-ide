import { execFileSync } from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vitest";

import * as ServerConfig from "./config.ts";
import {
  EXTENSION_GIT_STATUS_PATH,
  EXTENSION_READ_PROJECT_FILE_PATH,
  backendTokenMatches,
  handleExtensionBrokerRequest,
  layer as extensionBrokerLayer,
} from "./extensionBrokerRoutes.ts";
import { ProjectionSnapshotQuery } from "./orchestration-v2/ProjectionSnapshotQuery.ts";

const TOKEN = "a".repeat(48);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-ext-broker-"));
  roots.push(root);
  FS.mkdirSync(Path.join(root, "docs"));
  FS.writeFileSync(Path.join(root, "docs", "intro.md"), "Hello, Tabs\n");
  FS.writeFileSync(Path.join(Path.dirname(root), `${Path.basename(root)}-secret.txt`), "nope");
  return root;
}

async function call(input: {
  path: string;
  body: unknown;
  root: string;
  token?: string;
  address?: string;
}): Promise<{ status: number; body: unknown }> {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://127.0.0.1${input.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tabs-backend-token": input.token ?? TOKEN,
      },
      body: JSON.stringify(input.body),
    }),
  ).modify({ remoteAddress: Option.some(input.address ?? "127.0.0.1") });
  const response = await Effect.runPromise(
    handleExtensionBrokerRequest.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      Effect.provideService(ServerConfig.ServerConfig, {
        desktopBootstrapToken: TOKEN,
      } as unknown as ServerConfig.ServerConfig["Service"]),
      Effect.provideService(ProjectionSnapshotQuery, {
        getSnapshot: () =>
          Effect.succeed({
            projects: [
              { id: "p1", workspaceRoot: input.root, deletedAt: null },
              { id: "gone", workspaceRoot: input.root, deletedAt: "2026-11-01T00:00:00.000Z" },
            ],
          }),
      } as unknown as ProjectionSnapshotQuery["Service"]),
    ),
  );
  const web = HttpServerResponse.toWeb(response);
  return { status: web.status, body: await web.json() };
}

describe("extension broker routes", () => {
  it("reads a project file for the desktop, from the project's own root", async () => {
    const root = project();
    await expect(
      call({
        path: EXTENSION_READ_PROJECT_FILE_PATH,
        body: { projectId: "p1", relativePath: "docs/intro.md" },
        root,
      }),
    ).resolves.toEqual({ status: 200, body: { contents: "Hello, Tabs\n" } });
  });

  it("refuses escapes, unknown or deleted projects, other callers and bad tokens", async () => {
    const root = project();
    const read = (overrides: Partial<Parameters<typeof call>[0]>, body?: unknown) =>
      call({
        path: EXTENSION_READ_PROJECT_FILE_PATH,
        body: body ?? { projectId: "p1", relativePath: "docs/intro.md" },
        root,
        ...overrides,
      }).then((result) => result.status);
    const secret = `../${Path.basename(root)}-secret.txt`;
    expect(await read({}, { projectId: "p1", relativePath: secret })).toBe(400);
    expect(await read({}, { projectId: "p1", relativePath: "/etc/hosts" })).toBe(400);
    expect(await read({}, { projectId: "missing", relativePath: "docs/intro.md" })).toBe(404);
    expect(await read({}, { projectId: "gone", relativePath: "docs/intro.md" })).toBe(404);
    expect(await read({ address: "192.168.1.20" })).toBe(404);
    expect(await read({ token: "b".repeat(48) })).toBe(401);
    expect(await read({}, ["not", "an", "object"])).toBe(400);
  });

  it("reports the branch and dirty state of a Git project", async () => {
    const root = project();
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    const status = await call({ path: EXTENSION_GIT_STATUS_PATH, body: { projectId: "p1" }, root });
    expect(status).toEqual({ status: 200, body: { branch: "main", dirty: true } });
  });

  it("is mounted at the exact paths the desktop calls", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(
      extensionBrokerLayer.pipe(
        Layer.provideMerge(
          Layer.succeed(ServerConfig.ServerConfig, {
            desktopBootstrapToken: TOKEN,
          } as unknown as ServerConfig.ServerConfig["Service"]),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery, {
            getSnapshot: () => Effect.succeed({ projects: [] }),
          } as unknown as ProjectionSnapshotQuery["Service"]),
        ),
      ),
      { disableLogger: true },
    );
    try {
      for (const path of [EXTENSION_READ_PROJECT_FILE_PATH, EXTENSION_GIT_STATUS_PATH]) {
        // A web request has no socket address, so the handler answers as it
        // does for any non-local caller: proof the route, not the router, ran.
        const response = await handler(
          new Request(`http://127.0.0.1${path}`, { method: "POST", body: "{}" }),
        );
        expect(response.status, path).toBe(404);
        expect(await response.json(), path).toEqual({ error: "Not found." });
      }
    } finally {
      await dispose();
    }
  });

  it("compares tokens without accepting empty or mismatched lengths", () => {
    expect(backendTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(backendTokenMatches("short", TOKEN)).toBe(false);
    expect(backendTokenMatches(TOKEN, undefined)).toBe(false);
    expect(backendTokenMatches(undefined, TOKEN)).toBe(false);
  });
});
