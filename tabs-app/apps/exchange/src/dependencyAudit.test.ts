import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditNpmDependencies } from "./dependencyAudit.ts";

const roots: string[] = [];

function lockfile(value: unknown): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-dependency-audit-"));
  roots.push(root);
  FS.writeFileSync(Path.join(root, "package-lock.json"), JSON.stringify(value));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Exchange dependency advisory audit", () => {
  it("states when no npm lockfile was submitted", async () => {
    const result = await auditNpmDependencies("/unused", [], vi.fn());
    expect(result).toEqual({
      status: "not-declared",
      packagesChecked: 0,
      packagesSkipped: 0,
      findings: [],
    });
  });

  it("queries bounded exact npm versions and records advisory IDs", async () => {
    const root = lockfile({
      lockfileVersion: 3,
      packages: {
        "": { version: "1.0.0" },
        "node_modules/plain": {
          version: "1.2.3",
          resolved: "https://registry.npmjs.org/plain/-/plain-1.2.3.tgz",
        },
        "node_modules/@scope/widget": {
          version: "2.0.0-beta.1",
          resolved: "https://registry.npmjs.org/@scope/widget/-/widget-2.0.0-beta.1.tgz",
        },
        "node_modules/plain/node_modules/nested": {
          version: "3.0.1",
          resolved: "https://registry.npmjs.org/nested/-/nested-3.0.1.tgz",
        },
        "node_modules/git-source": { version: "git+https://example.invalid/repo" },
        "node_modules/private": {
          version: "4.0.0",
          resolved: "https://private.example.com/private.tgz",
        },
      },
    });
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { queries: unknown[] };
      return Response.json({
        results: body.queries.map((_, index) =>
          index === 1 ? { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] } : {},
        ),
      });
    });
    const result = await auditNpmDependencies(root, ["package-lock.json"], request);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("https://api.osv.dev/v1/querybatch");
    const queries = JSON.parse(request.mock.calls[0]?.[1].body as string).queries;
    expect(queries).toEqual([
      { package: { ecosystem: "npm", name: "plain" }, version: "1.2.3" },
      { package: { ecosystem: "npm", name: "@scope/widget" }, version: "2.0.0-beta.1" },
      { package: { ecosystem: "npm", name: "nested" }, version: "3.0.1" },
    ]);
    expect(result).toEqual({
      status: "partial",
      packagesChecked: 3,
      packagesSkipped: 2,
      findings: [
        { name: "@scope/widget", version: "2.0.0-beta.1", advisoryId: "GHSA-aaaa-bbbb-cccc" },
      ],
    });
  });

  it("does not claim completeness for unsupported lockfiles or advisory outages", async () => {
    const unsupported = lockfile({ lockfileVersion: 1, dependencies: {} });
    expect(await auditNpmDependencies(unsupported, ["package-lock.json"], vi.fn())).toMatchObject({
      status: "unsupported",
      packagesChecked: 0,
    });
    const root = lockfile({
      lockfileVersion: 3,
      packages: {
        "node_modules/plain": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/plain/-/plain-1.0.0.tgz",
        },
      },
    });
    const unavailable = await auditNpmDependencies(
      root,
      ["package-lock.json"],
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    expect(unavailable).toMatchObject({ status: "unavailable", packagesChecked: 0 });
    const paginated = await auditNpmDependencies(
      root,
      ["package-lock.json"],
      vi.fn(async () => Response.json({ results: [{ next_page_token: "more" }] })),
    );
    expect(paginated).toMatchObject({ status: "unavailable", packagesChecked: 0 });
  });

  it("bounds dependency count and splits advisory requests into small batches", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `node_modules/package-${index}`,
        {
          version: "1.0.0",
          resolved: `https://registry.npmjs.org/package-${index}/-/package-${index}-1.0.0.tgz`,
        },
      ]),
    );
    const oversized = lockfile({ lockfileVersion: 3, packages: many });
    const rejectedRequest = vi.fn();
    expect(
      await auditNpmDependencies(oversized, ["package-lock.json"], rejectedRequest),
    ).toMatchObject({ status: "unsupported", packagesChecked: 0 });
    expect(rejectedRequest).not.toHaveBeenCalled();

    const batches = lockfile({
      lockfileVersion: 3,
      packages: Object.fromEntries(Object.entries(many).slice(0, 51)),
    });
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { queries: unknown[] };
      return Response.json({ results: body.queries.map(() => ({})) });
    });
    expect(await auditNpmDependencies(batches, ["package-lock.json"], request)).toMatchObject({
      status: "complete",
      packagesChecked: 51,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
