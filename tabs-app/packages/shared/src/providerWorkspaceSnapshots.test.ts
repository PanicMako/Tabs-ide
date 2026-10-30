import { describe, expect, it } from "vitest";
import { ProviderInstanceId, type ServerProvider } from "@tabs/contracts";
import {
  omitProviderWorkspaceSnapshots,
  scopedProviderWorkspaceSnapshots,
  mergeProviderWorkspaceSnapshots,
} from "./providerWorkspaceSnapshots";
const provider = (id: string, cwds: string[]) =>
  ({
    instanceId: ProviderInstanceId.make(id),
    name: id,
    workspaceSnapshots: cwds.map((cwd) => ({
      cwd,
      slashCommands: [{ name: "large", description: "x".repeat(4096) }],
    })),
  }) as unknown as ServerProvider;
const a = provider("a", ["/one", "/two"]),
  b = provider("b", ["/one", "/three"]);
const scope = { instanceId: a.instanceId, cwd: "/one", fresh: false };
describe("on-demand provider capabilities", () => {
  it("omits workspace data while preserving the complete provider catalog", () => {
    const reduced = omitProviderWorkspaceSnapshots([a, b]);
    expect(reduced.map((p) => p.instanceId)).toEqual([a.instanceId, b.instanceId]);
    expect(reduced.every((p) => p.workspaceSnapshots === undefined)).toBe(true);
    expect(JSON.stringify(reduced).length).toBeLessThan(JSON.stringify([a, b]).length / 10);
    expect(a.workspaceSnapshots).toHaveLength(2);
  });
  it("returns only the requested provider and folder", () => {
    const payload = scopedProviderWorkspaceSnapshots([a, b], scope);
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0]!.workspaceSnapshots?.map((s) => s.cwd)).toEqual(["/one"]);
  });
  it("preserves other folders and providers on a scoped response", () => {
    const merged = mergeProviderWorkspaceSnapshots(
      [a, b],
      scopedProviderWorkspaceSnapshots([a, b], scope),
    );
    expect(merged[0]!.workspaceSnapshots?.map((s) => s.cwd).sort()).toEqual(["/one", "/two"]);
    expect(merged[1]).toEqual(b);
  });
  it("clears the same folder from other providers after an explicit fresh scan", () => {
    const merged = mergeProviderWorkspaceSnapshots(
      [a, b],
      scopedProviderWorkspaceSnapshots([a, b], { ...scope, fresh: true }),
    );
    expect(merged[0]!.workspaceSnapshots?.map((s) => s.cwd).sort()).toEqual(["/one", "/two"]);
    expect(merged[1]!.workspaceSnapshots?.map((s) => s.cwd)).toEqual(["/three"]);
  });
  it("retains cached workspaces across omitted status updates, but removes deleted providers", () => {
    const merged = mergeProviderWorkspaceSnapshots([a, b], {
      providers: omitProviderWorkspaceSnapshots([a]),
      workspaceSnapshotsOmitted: true,
    });
    expect(merged).toEqual([a]);
  });
  it("honors explicit empty workspaces and legacy full snapshots", () => {
    const merged = mergeProviderWorkspaceSnapshots([a, b], { providers: [provider("a", [])] });
    expect(merged).toEqual([provider("a", [])]);
    expect(
      mergeProviderWorkspaceSnapshots(
        [a, b],
        scopedProviderWorkspaceSnapshots([provider("a", [])], scope),
      )[0]!.workspaceSnapshots?.map((s) => s.cwd),
    ).toEqual(["/two"]);
  });
});
