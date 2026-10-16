import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Cut over only a fully uploaded, verified candidate; retain all original assets. */
export async function replaceDesktopRelease(options, api) {
  const { repository, tag, candidateTag, expectedReleaseId, expectedTagSha, sourceSha } = options;
  if (tag !== "v2.0.0" || !/^rerelease-candidate\/v2\.0\.0-\d+$/.test(candidateTag) || !/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(expectedTagSha)) throw new Error("Invalid explicitly authorized replacement identity.");
  const base = `repos/${repository}`;
  const tagPath = `${base}/git/refs/tags/${tag}`;
  const original = await api("GET", `${base}/releases/tags/${tag}`);
  const candidate = await api("GET", `${base}/releases/tags/${encodeURIComponent(candidateTag)}`);
  const reference = await api("GET", `${base}/git/ref/tags/${tag}`);
  if (String(original.id) !== String(expectedReleaseId) || reference.object.sha !== expectedTagSha || original.draft || original.immutable) throw new Error("Published release changed or is immutable; refusing replacement.");
  if (!candidate.draft || candidate.id === original.id || candidate.target_commitish !== sourceSha || candidate.assets.length < 14 || candidate.assets.some(asset => asset.state !== "uploaded" || !asset.digest || asset.size <= 0)) throw new Error("Candidate is not a complete verified draft for this commit.");
  const archiveTag = `archive/${tag}-${expectedTagSha.slice(0, 12)}`;
  const archive = await api("GET", `${base}/git/ref/tags/${archiveTag}`).catch(() => null);
  if (archive && archive.object.sha !== expectedTagSha) throw new Error("Archive tag already points to another build.");
  if (!archive) await api("POST", `${base}/git/refs`, { ref: `refs/tags/${archiveTag}`, sha: expectedTagSha });
  let originalArchived = false;
  try {
    // Recheck at the last possible point before changing the public release.
    const current = await api("GET", `${base}/git/ref/tags/${tag}`);
    if (current.object.sha !== expectedTagSha) throw new Error("Release tag moved during preparation.");
    await api("PATCH", `${base}/releases/${original.id}`, { tag_name: archiveTag, draft: true, name: `${original.name} (original archive)`, make_latest: "false" });
    originalArchived = true;
    // Use the workflow token for the ref to avoid starting a duplicate tag workflow.
    await api("PATCH", tagPath, { sha: sourceSha, force: true }, "workflow");
    await api("PATCH", `${base}/releases/${candidate.id}`, { tag_name: tag, target_commitish: sourceSha, name: "Tabs v2.0.0", draft: false, prerelease: false, make_latest: "true" });
  } catch (error) {
    if (originalArchived) {
      // A lost API response may follow a successful publication. Confirm before rollback.
      const published = await api("GET", `${base}/releases/${candidate.id}`).catch(() => null);
      if (published?.tag_name === tag && !published.draft) return { releaseId: candidate.id, archiveTag, confirmedAfterRetry: true };
      await api("PATCH", `${base}/releases/${candidate.id}`, { tag_name: candidateTag, draft: true });
      await api("PATCH", tagPath, { sha: expectedTagSha, force: true }, "workflow");
      await api("PATCH", `${base}/releases/${original.id}`, { tag_name: tag, draft: false, name: original.name, prerelease: original.prerelease, make_latest: "true" });
    }
    throw error;
  }
  return { releaseId: candidate.id, archiveTag };
}

async function ghApi(method, path, body, credential = "release") {
  const args = ["api", "--method", method, path];
  if (body) args.push("--input", "-");
  const env = { ...process.env, GH_TOKEN: credential === "workflow" ? process.env.GITHUB_TOKEN : process.env.GH_TOKEN };
  return Promise.resolve(JSON.parse(execFileSync("gh", args, { env, input: body ? JSON.stringify(body) : undefined, encoding: "utf8" })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = { repository: process.env.GITHUB_REPOSITORY, tag: process.env.RELEASE_TAG, candidateTag: process.env.CANDIDATE_TAG, expectedReleaseId: process.env.EXPECTED_RELEASE_ID, expectedTagSha: process.env.EXPECTED_TAG_SHA, sourceSha: process.env.RELEASE_SHA };
  // Persist original metadata as a workflow artifact, independently of the archived release.
  const original = await ghApi("GET", `repos/${options.repository}/releases/tags/${options.tag}`);
  writeFileSync("original-release-recovery.json", JSON.stringify({ options, original }, null, 2));
  const result = await replaceDesktopRelease(options, ghApi);
  console.log(JSON.stringify({ replaced: options.tag, ...result }));
}
