import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspaceMemberModulesFilter,
  readCodeOssWorkspaceMembers,
} from "./code-oss-workspace.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeCheckout(workspace: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-code-oss-workspace-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), workspace);
  return root;
}

describe("Code-OSS workspace staging", () => {
  it("reads the package folders and stops at the next setting", () => {
    const root = makeCheckout(
      "packages:\n  - .eslint-plugin-local\n  - extensions/copilot\n  - scripts\n  - 'test/unit'\npnpmfile: .pnpmfile.mjs\nnodeLinker: isolated\n",
    );

    expect(readCodeOssWorkspaceMembers(root)).toEqual([
      ".eslint-plugin-local",
      "extensions/copilot",
      "scripts",
      "test/unit",
    ]);
  });

  it("leaves out only the node_modules of workspace members", () => {
    const root = makeCheckout("packages:\n  - scripts\n");
    const include = createWorkspaceMemberModulesFilter(root);

    expect(include(path.join(root, "scripts", "node_modules"))).toBe(false);
    expect(include(path.join(root, "scripts", "code.sh"))).toBe(true);
    expect(include(path.join(root, "scripts", "lib", "node_modules"))).toBe(true);
    expect(include(path.join(root, "node_modules"))).toBe(true);
  });

  it("copies a member folder without its dangling module links", () => {
    const root = makeCheckout("packages:\n  - scripts\n");
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-code-oss-staged-"));
    roots.push(destination);
    fs.mkdirSync(path.join(root, "scripts", "node_modules", "@playwright"), { recursive: true });
    fs.symlinkSync(
      path.join(root, "node_modules", ".pnpm", "missing"),
      path.join(root, "scripts", "node_modules", "@playwright", "test"),
      "dir",
    );
    fs.writeFileSync(path.join(root, "scripts", "code.sh"), "#!/bin/sh\n");

    fs.cpSync(path.join(root, "scripts"), path.join(destination, "scripts"), {
      recursive: true,
      filter: createWorkspaceMemberModulesFilter(root),
    });

    expect(fs.readdirSync(path.join(destination, "scripts"))).toEqual(["code.sh"]);
  });
});
