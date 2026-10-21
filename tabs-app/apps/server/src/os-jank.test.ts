import * as NodeOS from "node:os";
import { assert, it, vi } from "vitest";

vi.mock("@tabs/shared/shell", () => ({ readPathFromLoginShell: vi.fn() }));
import { readPathFromLoginShell } from "@tabs/shared/shell";
import { fixPath, hydratePosixHome } from "./os-jank.ts";

it("reuses the shell environment already resolved by the desktop parent", () => {
  const inherited = process.env.TABS_DESKTOP_SHELL_ENV_READY;
  const path = process.env.PATH;
  process.env.TABS_DESKTOP_SHELL_ENV_READY = "1";
  try {
    fixPath();
    assert.equal(vi.mocked(readPathFromLoginShell).mock.calls.length, 0);
    assert.equal(process.env.PATH, path);
  } finally {
    if (inherited === undefined) delete process.env.TABS_DESKTOP_SHELL_ENV_READY;
    else process.env.TABS_DESKTOP_SHELL_ENV_READY = inherited;
  }
});

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});
