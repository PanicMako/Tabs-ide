// Writes the run summary for Build Desktop Installers and Release Desktop:
// every installer the run produced (from the packaging jobs' manifests) and
// how long each stage took (from the Actions jobs API).
//
// Called from actions/github-script:
//   const summarize = require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/desktop-build-summary.cjs`);
//   await summarize({ github, context, core, manifestDir: 'installer-manifest', title: '…' });
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INSTALLER_KINDS = [
  [/\.dmg$/i, "DMG"],
  [/\.zip$/i, "ZIP (updater)"],
  [/\.AppImage$/i, "AppImage"],
  [/\.deb$/i, "Debian package"],
  [/\.exe$/i, "NSIS installer"],
  [/\.appx$/i, "Store AppX"],
];

function installerKind(name) {
  for (const [pattern, kind] of INSTALLER_KINDS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

const RESULT_LABEL = {
  success: "✅ passed",
  failure: "❌ failed",
  cancelled: "⏹ cancelled",
  skipped: "⏭ skipped",
  timed_out: "⏱ timed out",
};

function readManifests(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8")));
}

module.exports = async function summarize({ github, context, core, manifestDir, title }) {
  const manifests = readManifests(manifestDir);
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId,
    attempt_number: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
    per_page: 100,
  });
  const { data: run } = await github.rest.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId,
  });

  const stageJobs = jobs
    .filter((job) => job.name !== "Summary")
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));

  // Installers
  const installerRows = [];
  let installerCount = 0;
  let extraFiles = 0;
  for (const manifest of manifests.sort((a, b) => a.label.localeCompare(b.label))) {
    const job = stageJobs.find((candidate) => candidate.name.endsWith(manifest.label));
    const status = job ? RESULT_LABEL[job.conclusion] ?? job.status : "–";
    const installers = manifest.files.filter((file) => installerKind(file.name));
    extraFiles += manifest.files.length - installers.length;
    if (installers.length === 0) {
      installerRows.push([manifest.label, "–", "no installer", "–", "–", status]);
      continue;
    }
    for (const file of installers) {
      installerCount += 1;
      installerRows.push([
        manifest.label,
        installerKind(file.name),
        `<code>${file.name}</code>`,
        formatBytes(file.bytes),
        `<code>${file.sha256.slice(0, 12)}</code>`,
        status,
      ]);
    }
  }

  // Stages
  const stageRows = stageJobs.map((job) => {
    const started = job.started_at ? Date.parse(job.started_at) : NaN;
    const completed = job.completed_at ? Date.parse(job.completed_at) : Date.now();
    return [
      job.name,
      RESULT_LABEL[job.conclusion] ?? job.status,
      job.conclusion === "skipped" ? "–" : formatDuration(completed - started),
    ];
  });

  const failed = stageJobs.filter((job) =>
    ["failure", "timed_out", "cancelled"].includes(job.conclusion),
  );
  const wallClock = formatDuration(Date.now() - Date.parse(run.run_started_at || run.created_at));
  const headline = failed.length
    ? `${failed.length} stage(s) did not pass: ${failed.map((job) => job.name).join(", ")}.`
    : `${installerCount} installer file(s) built and verified.`;

  core.summary
    .addHeading(title, 2)
    .addRaw(
      `<p><strong>${headline}</strong><br>` +
        `Commit <code>${context.sha.slice(0, 12)}</code> · ${context.ref.replace(/^refs\/(heads|tags)\//, "")} · ` +
        `${wallClock} wall clock</p>`,
      true,
    );

  if (installerRows.length) {
    core.summary.addHeading("Installers", 3).addTable([
      [
        { data: "Package job", header: true },
        { data: "Format", header: true },
        { data: "File", header: true },
        { data: "Size", header: true },
        { data: "SHA-256", header: true },
        { data: "Result", header: true },
      ],
      ...installerRows,
    ]);
    if (extraFiles) {
      core.summary.addRaw(
        `<p>Plus ${extraFiles} update-metadata and blockmap file(s) in the same artifacts.</p>`,
        true,
      );
    }
  } else {
    core.summary.addRaw("<p>No installers were produced.</p>", true);
  }

  core.summary.addHeading("Stages", 3).addTable([
    [
      { data: "Job", header: true },
      { data: "Result", header: true },
      { data: "Duration", header: true },
    ],
    ...stageRows,
  ]);

  await core.summary.write();
};
