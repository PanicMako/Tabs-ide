import { it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { GitEnvironment } from "../Services/GitEnvironment.ts";
import {
  GitEnvironmentLive,
  parseGhHostsFile,
  resetGitEnvironmentCachesForTests,
} from "./GitEnvironment.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitEnvironmentLive);

// Hermetic: the real machine's `hosts.yml` must not decide which read these tests exercise.
process.env.GH_CONFIG_DIR = "/nonexistent-gh-config-for-tests";

afterEach(() => mockedRunProcess.mockReset());

it("reads accounts and the active user from hosts.yml", () => {
  expect(
    parseGhHostsFile(
      [
        "github.com:",
        "    git_protocol: https",
        "    users:",
        "        PanicMako:",
        "            oauth_token: x",
        "        Other:",
        "    user: PanicMako",
        "ghe.example.com:",
        "    user: solo",
        "",
      ].join("\n"),
    ),
  ).toEqual([
    { host: "github.com", login: "PanicMako", active: true },
    { host: "github.com", login: "Other", active: false },
    { host: "ghe.example.com", login: "solo", active: true },
  ]);
  expect(parseGhHostsFile("")).toBeNull();
});

layer("GitEnvironmentLive", (it) => {
  for (const offline of [false, true]) {
    it.effect(
      offline
        ? "retains cached account details when offline"
        : "refreshes renamed profiles and preserves the credential label",
      () =>
        Effect.gen(function* () {
          mockedRunProcess.mockImplementation(async (_command, args) => ({
            stdout:
              args[0] === "auth"
                ? "github.com\n  ✓ Logged in to github.com account old-name (keyring)\n  - Active account: true\n  - Token scopes: 'repo'"
                : args[0] === "api"
                  ? offline
                    ? ""
                    : "new-name\n"
                  : "version 1",
            stderr: "",
            code: offline && args[0] === "api" ? 1 : 0,
            signal: null,
            timedOut: false,
          }));
          const environment = yield* GitEnvironment;
          const result = yield* environment.detect({ cwd: "/repo" });
          expect(result.gitHub.activeLogin).toBe(offline ? "old-name" : "new-name");
          expect(result.gitHub.accounts[0]?.authLogin).toBe("old-name");
          expect(mockedRunProcess).toHaveBeenCalledWith(
            "gh",
            ["api", "user", "--hostname", "github.com", "--jq", ".login"],
            expect.objectContaining({ cwd: "/repo" }),
          );
        }),
    );
  }

  it.effect("passes release text as literal process arguments", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const environment = yield* GitEnvironment;

      yield* environment.publishRelease({
        cwd: "/repo",
        tag: "v1.3.0",
        title: "Release; $(literal)",
        notes: "Notes with `literal` shell text",
        prerelease: true,
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "release",
          "create",
          "v1.3.0",
          "--title",
          "Release; $(literal)",
          "--notes",
          "Notes with `literal` shell text",
          "--prerelease",
        ],
        { cwd: "/repo", timeoutMs: 15_000, allowNonZeroExit: true },
      );
    }),
  );

  it.effect("passes workflow inputs as literal process arguments", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const environment = yield* GitEnvironment;

      yield* environment.triggerReleaseWorkflow({
        cwd: "/repo",
        ref: "release; $(literal)",
        version: "1.3.0; $(literal)",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "workflow",
          "run",
          "release.yml",
          "--ref",
          "release; $(literal)",
          "--field",
          "version=1.3.0; $(literal)",
        ],
        { cwd: "/repo", timeoutMs: 15_000, allowNonZeroExit: true },
      );
    }),
  );
});

layer("GitEnvironmentLive account switching and avatars", (it) => {
  const authText = (active: string) =>
    [
      "github.com",
      `  ✓ Logged in to github.com account alpha (keyring)`,
      `  - Active account: ${active === "alpha"}`,
      "  - Token scopes: 'repo'",
      `  ✓ Logged in to github.com account beta (keyring)`,
      `  - Active account: ${active === "beta"}`,
      "  - Token scopes: 'repo'",
    ].join("\n");
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, signal: null, timedOut: false });

  it.effect("inlines each account's profile picture so the page loads nothing remote", () =>
    Effect.gen(function* () {
      resetGitEnvironmentCachesForTests();
      process.env.TABS_FORCE_AVATAR = "1";
      const fetchMock = vi.fn(
        async () =>
          new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        mockedRunProcess.mockImplementation(async (_command, args) =>
          ok(args[0] === "auth" ? authText("alpha") : args[0] === "api" ? "alpha\n" : "v 1"),
        );
        const environment = yield* GitEnvironment;
        const result = yield* environment.detect({ cwd: "/repo" });
        expect(result.gitHub.accounts.map((a) => a.avatarUrl?.slice(0, 22))).toEqual([
          "data:image/png;base64,",
          "data:image/png;base64,",
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        delete process.env.TABS_FORCE_AVATAR;
        vi.unstubAllGlobals();
      }
    }),
  );

  it.effect("refuses to switch while an environment token overrides the CLI's account", () =>
    Effect.gen(function* () {
      process.env.GH_TOKEN = "ghp_example";
      try {
        const environment = yield* GitEnvironment;
        const error = yield* environment
          .switchAccount({ host: "github.com", login: "beta" })
          .pipe(Effect.flip);
        expect(String(error.detail)).toContain("GH_TOKEN");
        expect(mockedRunProcess).not.toHaveBeenCalled();
      } finally {
        delete process.env.GH_TOKEN;
      }
    }),
  );

  it.effect("switches with the credential label and re-reads the accounts", () =>
    Effect.gen(function* () {
      resetGitEnvironmentCachesForTests();
      let active = "alpha";
      mockedRunProcess.mockImplementation(async (_command, args) => {
        if (args[0] === "auth" && args[1] === "switch") {
          active = args[args.indexOf("--user") + 1]!;
          return ok("");
        }
        return ok(
          args[0] === "auth" ? authText(active) : args[0] === "api" ? `${active}\n` : "v 1",
        );
      });
      const environment = yield* GitEnvironment;
      const result = yield* environment.switchAccount({ host: "github.com", login: "beta" });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["auth", "switch", "--hostname", "github.com", "--user", "beta"],
        expect.anything(),
      );
      expect(result.gitHub.activeLogin).toBe("beta");
    }),
  );
});
