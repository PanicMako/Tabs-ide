import { it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { GitEnvironment } from "../Services/GitEnvironment.ts";
import { GitEnvironmentLive } from "./GitEnvironment.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitEnvironmentLive);

afterEach(() => mockedRunProcess.mockReset());

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
