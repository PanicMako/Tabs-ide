import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceDesktopRelease } from "./replace-desktop-release.mjs";

const oldSha = "a".repeat(40), newSha = "b".repeat(40);
const options = { repository: "PanicMako/Tabs-ide", tag: "v2.0.0", candidateTag: "rerelease-candidate/v2.0.0-123", expectedReleaseId: "10", expectedTagSha: oldSha, sourceSha: newSha };
function fixture({ failPublish = false, changed = false } = {}) {
  const calls = [];
  const releases = new Map([[10, { id: 10, tag_name: "v2.0.0", name: "Tabs v2.0.0", draft: false, prerelease: false, assets: [{ id: 999 }] }], [20, { id: 20, tag_name: options.candidateTag, draft: true, target_commitish: newSha, assets: Array.from({ length: 14 }, (_, id) => ({ id, state: "uploaded", digest: "sha256:test", size: 1 })) }]]);
  let tagSha = changed ? "c".repeat(40) : oldSha;
  const api = async (method, path, body, credential) => {
    calls.push({ method, path, body, credential });
    if (method === "GET" && path.endsWith("git/ref/tags/v2.0.0")) return { object: { sha: tagSha } };
    if (method === "GET" && path.includes("/git/ref/tags/archive/")) throw Error("Not found");
    if (method === "GET" && path.includes("/releases/tags/")) return structuredClone([...releases.values()].find(release => path.endsWith(encodeURIComponent(release.tag_name)) || path.endsWith(release.tag_name)));
    if (method === "GET" && /releases\/\d+$/.test(path)) return structuredClone(releases.get(Number(path.split("/").at(-1))));
    if (method === "POST") return {};
    if (method === "PATCH" && path.includes("/git/refs/")) { tagSha = body.sha; return {}; }
    if (method === "PATCH") {
      const id = Number(path.split("/").at(-1));
      if (id === 20 && body.draft === false && failPublish) throw Error("Publication failed");
      Object.assign(releases.get(id), body); return structuredClone(releases.get(id));
    }
    throw Error("Unexpected API call");
  };
  return { api, calls, releases, tagSha: () => tagSha };
}

test("archives the original assets and publishes only the prepared candidate", async () => {
  const state = fixture(); const result = await replaceDesktopRelease(options, state.api);
  assert.equal(result.releaseId, 20); assert.equal(state.tagSha(), newSha);
  assert.equal(state.releases.get(10).draft, true); assert.equal(state.releases.get(10).assets[0].id, 999);
  assert.equal(state.releases.get(20).tag_name, "v2.0.0"); assert.equal(state.releases.get(20).draft, false);
  assert.equal(state.calls.filter(call => call.method === "DELETE").length, 0);
  assert.equal(state.calls.find(call => call.path.includes("/git/refs/tags/")).credential, "workflow");
});
test("refuses stale release identity before any mutation", async () => {
  const state = fixture({ changed: true }); await assert.rejects(replaceDesktopRelease(options, state.api), /changed/);
  assert.ok(state.calls.every(call => call.method === "GET"));
});
test("restores original tag and publication if candidate publishing fails", async () => {
  const state = fixture({ failPublish: true }); await assert.rejects(replaceDesktopRelease(options, state.api), /Publication failed/);
  assert.equal(state.tagSha(), oldSha); assert.equal(state.releases.get(10).draft, false); assert.equal(state.releases.get(10).tag_name, "v2.0.0");
  assert.equal(state.releases.get(20).draft, true);
});
