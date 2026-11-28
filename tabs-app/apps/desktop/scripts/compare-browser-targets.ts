/** bun apps/desktop/scripts/compare-browser-targets.ts (requires local Chromium and Git history). */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { startDeviceDraftApp } from "../../server/scripts/fixtures/deviceDraft.ts";
import { pageTargetExpression } from "../src/browserPageTarget";

const revision = "31816cf538073cb98d70fb934ad771cc05f94a75";
const baseline = execFileSync(
  "git",
  ["show", revision + ":tabs-app/apps/desktop/src/browserHostManager.ts"],
  {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    encoding: "utf8",
  },
);
const start = baseline.indexOf("function pageTargetExpression(");
const end = baseline.indexOf("\n}\n", start);
if (start < 0 || end < start) throw new Error("The baseline locator implementation was not found.");
const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
  baseline.slice(start, end + 2),
);
const previous = Function(
  transpiled + "; return pageTargetExpression",
)() as typeof pageTargetExpression;
function describeFile(filename: string, contents: Buffer) {
  return {
    filename,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

const expectedFile = describeFile(
  "qa-report-December.csv",
  Buffer.from("Area,Status\nCheckout,Passed"),
);
function matchesExpectedFile(file: typeof expectedFile | null) {
  return (
    file?.filename === expectedFile.filename &&
    file.bytes === expectedFile.bytes &&
    file.sha256 === expectedFile.sha256
  );
}

const browser = await chromium.launch({ headless: true });
try {
  async function trial(locate: typeof pageTargetExpression, selectedPosition: number) {
    const fixture = await startDeviceDraftApp();
    const contexts: BrowserContext[] = [];
    try {
      const work = await browser.newContext();
      contexts.push(work);
      const personal = await browser.newContext();
      contexts.push(personal);
      const page = await work.newPage();
      const personalPage = await personal.newPage();
      const url = `${fixture.origin}/reports/benchmark?position=${selectedPosition}`;
      await Promise.all([
        page.goto(fixture.origin + "/Work"),
        personalPage.goto(fixture.origin + "/Personal"),
      ]);
      await Promise.all([page.goto(url), personalPage.goto(url)]);
      await Promise.all([
        page.getByText("Work", { exact: true }).waitFor(),
        personalPage.getByText("Personal", { exact: true }).waitFor(),
      ]);
      const started = performance.now();
      let correctionStarted: number | undefined;
      try {
        await page.evaluate(locate({ locator: "role=button[name='Export']" }) + "?.click()");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Several controls")) throw error;
        correctionStarted = performance.now();
        await page.getByRole("region", { name: "Selected rows" }).getByRole("button").click();
      }
      await page.getByLabel("Reporting month").fill("December");
      await page.getByRole("button", { name: "Attach report to draft" }).click();
      const receipt = page.locator("#attached-report");
      await receipt.waitFor({ state: "visible" });
      const downloaded = await receipt.evaluate(async (link) => {
        if (!(link instanceof HTMLAnchorElement) || link.hidden) return null;
        const file = await fetch(link.href, { cache: "no-store" });
        return file.ok
          ? { filename: link.download, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }
          : null;
      });
      const finished = performance.now();
      const attachment = downloaded
        ? describeFile(downloaded.filename, Buffer.from(downloaded.bytes))
        : null;

      await Promise.all([page.reload(), personalPage.reload()]);
      let reloadedAttachment: typeof expectedFile | null = null;
      if (await receipt.isVisible()) {
        const [download] = await Promise.all([page.waitForEvent("download"), receipt.click()]);
        reloadedAttachment = describeFile(
          download.suggestedFilename(),
          await buffer(await download.createReadStream()),
        );
      }
      const personalAttachmentVisible = await personalPage.locator("#attached-report").isVisible();
      const personalAttachmentStatus = (
        await personal.request.get(fixture.origin + "/reports/benchmark/attachment")
      ).status();
      const { reportExports, reportDrafts } = fixture.trialCounts();
      const { Work, Personal } = reportExports;
      const wrongTarget = Work.all + Work.archived;
      const personalExports = Object.values(Personal).reduce((sum, count) => sum + count, 0);
      const duplicateExports = Math.max(0, Work.selected + wrongTarget + personalExports - 1);
      const duplicateDraftSaves = Math.max(
        0,
        (reportDrafts.Work?.saves ?? 0) + (reportDrafts.Personal?.saves ?? 0) - 1,
      );
      return {
        selectedPosition,
        completed:
          matchesExpectedFile(attachment) &&
          matchesExpectedFile(reloadedAttachment) &&
          matchesExpectedFile(reportDrafts.Work) &&
          reportDrafts.Work?.saves === 1 &&
          reportDrafts.Personal === null &&
          Work.selected === 1 &&
          wrongTarget === 0 &&
          personalExports === 0 &&
          !personalAttachmentVisible &&
          personalAttachmentStatus === 404,
        wrongTarget,
        personalExports,
        duplicateExports,
        duplicateDraftSaves,
        elapsedMs: Math.round(finished - started),
        correctionToReceiptMs:
          correctionStarted === undefined ? null : Math.round(finished - correctionStarted),
        reportExports,
        reportDrafts,
        attachment,
        reloadedAttachment,
        personalAttachmentVisible,
        personalAttachmentStatus,
      };
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
      await fixture.close();
    }
  }

  const baselineTrials = [];
  const currentTrials = [];
  for (const position of [0, 1, 2]) {
    if (position % 2 === 0) {
      baselineTrials.push(await trial(previous, position));
      currentTrials.push(await trial(pageTargetExpression, position));
    } else {
      currentTrials.push(await trial(pageTargetExpression, position));
      baselineTrials.push(await trial(previous, position));
    }
  }
  const summarize = (trials: Awaited<ReturnType<typeof trial>>[]) => ({
    completed: trials.filter((result) => result.completed).length,
    wrongTarget: trials.reduce((sum, result) => sum + result.wrongTarget, 0),
    personalExports: trials.reduce((sum, result) => sum + result.personalExports, 0),
    duplicateExports: trials.reduce((sum, result) => sum + result.duplicateExports, 0),
    duplicateDraftSaves: trials.reduce((sum, result) => sum + result.duplicateDraftSaves, 0),
    clarification: trials.filter((result) => result.correctionToReceiptMs !== null).length,
    recoveredAfterClarification: trials.filter(
      (result) => result.completed && result.correctionToReceiptMs !== null,
    ).length,
    elapsedMs: trials.reduce((sum, result) => sum + result.elapsedMs, 0),
    trials,
  });
  const counts = { baseline: summarize(baselineTrials), workingTree: summarize(currentTrials) };
  console.log(
    JSON.stringify(
      {
        revision,
        chromium: browser.version(),
        task: "export-selected-rows",
        fixture: "deviceDraft /reports/benchmark",
        trialsPerVersion: 3,
        expectedFile,
        clarification: "Scripted user demonstration using a trusted click.",
        foregroundInterruptions: null,
        timing:
          "Headless Chromium from the export attempt through the first attachment read, excluding setup, post-reload verification, and human and model time.",
        counts,
      },
      null,
      2,
    ),
  );
  if (counts.workingTree.completed !== 3) process.exitCode = 1;
} finally {
  await browser.close();
}
