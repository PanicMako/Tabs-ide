import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { expect, it } from "vitest";
import { prepareBrowserQuickActionValues } from "@tabs/shared/browserQuickAction";

import {
  replayBrowserQuickAction,
  validatedBrowserQuickAction,
} from "../../../../../desktop/src/browserQuickAction.ts";
import { startDeviceDraftApp } from "../../../../scripts/fixtures/deviceDraft.ts";
import { JourneyRecorder } from "../../../../../desktop/src/journeyRecorder.ts";
import { browserQuickActionProbe } from "../../../../../desktop/src/browserQuickActionDom.ts";

it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
  "verifies saved benchmark exports and counts wrong or repeated actions by profile",
  async () => {
    const site = await startDeviceDraftApp();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch();
      const work = await browser.newPage();
      const personal = await browser.newPage();
      await work.goto(site.origin + "/Work");
      await personal.goto(site.origin + "/Personal");
      const endpoint = site.origin + "/reports/benchmark";
      const attachmentUrl = endpoint + "/attachment";
      const expectedCsv = "Area,Status\nCheckout,Passed";
      const describeCsv = (csv: string, saves: number) => ({
        filename: "qa-report-December.csv",
        bytes: Buffer.byteLength(csv),
        sha256: createHash("sha256").update(csv).digest("hex"),
        saves,
      });

      for (const position of [0, 1, 2]) {
        await work.goto(`${endpoint}?position=${position}`);
        const regions = work.getByRole("region").filter({
          has: work.getByRole("button", { name: "Export", exact: true }),
        });
        expect(await regions.count()).toBe(3);
        expect(await regions.nth(position).getAttribute("aria-label")).toBe("Selected rows");
        await work
          .getByRole("region", { name: "Selected rows" })
          .getByRole("button", { name: "Export", exact: true })
          .click();
        await work.getByLabel("Reporting month").fill("December");
        await work.getByRole("button", { name: "Attach report to draft" }).click();
        await work.getByRole("link", { name: "qa-report-December.csv" }).waitFor();
        await work.reload();
        const [download] = await Promise.all([
          work.waitForEvent("download"),
          work.getByRole("link", { name: "qa-report-December.csv" }).click(),
        ]);
        expect(download.suggestedFilename()).toBe("qa-report-December.csv");
        expect(await readFile(await download.path(), "utf8")).toBe(expectedCsv);
      }
      expect(site.trialCounts().reportDrafts).toEqual({
        Work: describeCsv(expectedCsv, 3),
        Personal: null,
      });
      expect((await personal.request.get(attachmentUrl)).status()).toBe(404);

      await personal.goto(`${endpoint}?position=1`);
      for (const [page, region, csv] of [
        [work, "All reports", "Area,Status\nCheckout,Passed\nDelivery,Needs review"],
        [personal, "Archived", "Area,Status\nPrevious release,Archived"],
      ] as const) {
        const receipt = page.getByRole("link", { name: "qa-report-December.csv" });
        await page
          .getByRole("region", { name: region })
          .getByRole("button", { name: "Export", exact: true })
          .click();
        expect(await receipt.isVisible()).toBe(false);
        await page.getByLabel("Reporting month").fill("December");
        await page.getByRole("button", { name: "Attach report to draft" }).click();
        const [download] = await Promise.all([page.waitForEvent("download"), receipt.click()]);
        expect(await readFile(await download.path(), "utf8")).toBe(csv);
      }

      expect((await work.request.get(`${endpoint}?position=3`)).status()).toBe(400);
      expect((await personal.request.post(`${endpoint}?choice=other`)).status()).toBe(400);
      expect(site.trialCounts().reportExports).toEqual({
        Work: { selected: 3, all: 1, archived: 0 },
        Personal: { selected: 0, all: 0, archived: 1 },
      });
      expect(site.trialCounts().reportDrafts).toEqual({
        Work: describeCsv(expectedCsv + "\nDelivery,Needs review", 4),
        Personal: describeCsv("Area,Status\nPrevious release,Archived", 1),
      });
    } finally {
      await browser?.close();
      await site.close();
    }
  },
  30_000,
);

it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
  "replays a redesigned report flow and rejects a stale attachment",
  async () => {
    const site = await startDeviceDraftApp();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(site.origin + "/Work");
      await page.getByRole("link", { name: "Monthly QA report" }).click();
      const cdp = await page.context().newCDPSession(page);
      const debuggerApi = Object.assign(new EventEmitter(), {
        isAttached: () => false,
        attach: () => {},
        sendCommand: cdp.send.bind(cdp),
      });
      cdp.on("Runtime.bindingCalled", (event) =>
        debuggerApi.emit("message", {}, "Runtime.bindingCalled", event),
      );
      const contents = Object.assign(new EventEmitter(), {
        debugger: debuggerApi,
        getURL: () => page.url(),
        isDestroyed: () => page.isClosed(),
      });
      const recorder = new JourneyRecorder(
        contents as unknown as ConstructorParameters<typeof JourneyRecorder>[0],
      );
      await recorder.start(true);
      await page.getByRole("button", { name: "Export selected rows" }).click();
      await page.getByLabel("Reporting month").fill("November");
      await page.getByRole("button", { name: "Attach report to draft" }).click();
      await expect.poll(() => recorder.status().count).toBe(3);
      const recorded = await recorder.stop();
      expect(recorded.steps.map((step) => step.semantic?.name)).toEqual([
        "Export selected rows",
        "Reporting month",
        "Attach report to draft",
      ]);
      expect(JSON.stringify(recorded.steps)).not.toContain("November");

      await page.reload();
      await page.getByRole("checkbox", { name: "Checkout" }).uncheck();
      await page.getByRole("checkbox", { name: "Delivery" }).check();
      await page.evaluate(`(() => {
        const exportButton = document.querySelector("#export-selected");
        exportButton.id = "export-v2";
        document.body.prepend(exportButton);
        document.querySelector("#report-month").id = "month-v2";
        document.querySelector("#attach-report").id = "attach-v2";
        const receipt = document.querySelector("#attached-report");
        receipt.id = "receipt-v2";
        receipt.setAttribute("aria-label", "Monthly report attachment");
      })()`);

      const report = validatedBrowserQuickAction({
        id: randomUUID(),
        origin: site.origin,
        label: "Attach monthly report",
        steps: recorded.steps.map((step) => ({
          action: step.action,
          selector: step.selector,
          tag: step.tag,
          semantic: step.semantic,
          ...(step.action === "fill" ? { parameter: "report_month" } : {}),
        })),
        outcome: {
          selector: "#attached-report",
          semantic: { role: "link", name: "Monthly report attachment", group: "Draft attachments" },
          description: "Report attached",
          filenamePattern: "qa-report-{report_month}.csv",
        },
      });
      const replayDecember = (allowWebsiteDownloads = false) =>
        replayBrowserQuickAction(
          {
            executeJavaScriptInIsolatedWorld: async (_world, scripts) => {
              const { frameTree } = await cdp.send("Page.getFrameTree");
              const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
                frameId: frameTree.frame.id,
                worldName: "quick-action-test",
              });
              const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
                contextId: executionContextId,
                expression: scripts[0]!.code,
                awaitPromise: true,
                returnByValue: true,
              });
              if (exceptionDetails) throw new Error(exceptionDetails.text);
              return result.value;
            },
          },
          report,
          prepareBrowserQuickActionValues(report, { report_month: "December" }),
          0,
          () => {},
          allowWebsiteDownloads,
        );
      const result = await replayDecember();
      expect(result).toMatchObject({ status: "pass", completedSteps: 3 });
      const attachment = page.getByRole("link", { name: "Monthly report attachment" });
      await expect(attachment.getAttribute("download")).resolves.toBe("qa-report-December.csv");
      const href = await attachment.getAttribute("href");
      if (!href) throw new Error("The report is missing its attachment URL.");
      const csv = await page.evaluate(async (url) => (await fetch(url)).text(), href);
      expect(csv).toBe("Area,Status\nDelivery,Needs review");
      expect(result.fileReceipt).toEqual({
        filename: "qa-report-December.csv",
        byteLength: Buffer.byteLength(csv),
        sha256: createHash("sha256").update(csv).digest("hex"),
      });
      expect(await replayDecember()).toMatchObject({
        status: "fail",
        completedSteps: 0,
        message: expect.stringContaining("already visible"),
      });

      await page.reload();
      await page.evaluate(`(() => {
        const receipt = document.querySelector("#attached-report");
        receipt.href = "data:text/csv,November";
        receipt.download = "qa-report-November.csv";
        receipt.setAttribute("aria-label", "Monthly report attachment");
        document.querySelector("#report-draft").addEventListener("submit", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          receipt.hidden = false;
        }, { capture: true });
      })()`);
      expect(await replayDecember()).toMatchObject({
        status: "paused",
        completedSteps: 3,
        message: expect.stringContaining("expected filename"),
      });
      await expect(page.getByLabel("Reporting month").inputValue()).resolves.toBe("December");
      await expect(attachment.getAttribute("download")).resolves.toBe("qa-report-November.csv");

      let requests = 0;
      let filenameOnlyAccepted = 0;
      let filesVerified = 0;
      await page.route("https://other.test/**", async (route) => {
        requests++;
        await route.abort();
      });
      await page.route(site.origin + "/attachment/*.csv", async (route) => {
        requests++;
        const url = route.request().url();
        if (url.endsWith("redirect.csv")) {
          await route.fulfill({
            status: 302,
            headers: { location: "https://other.test/report.csv" },
          });
          return;
        }
        if (url.endsWith("changed.csv"))
          await page.evaluate(
            'document.querySelector("#attached-report").setAttribute("href", "/attachment/other.csv")',
          );
        await route.fulfill({
          contentType: url.endsWith("login.csv") ? "text/html" : "text/csv",
          headers: url.endsWith("renamed.csv")
            ? { "content-disposition": "attachment; filename=November.csv" }
            : {},
          body: url.endsWith("login.csv") ? "<h1>Sign in</h1>" : csv,
        });
      });
      for (const [path, allowWebsite, expected, attempts] of [
        ["revoked-blob", false, "could not verify the file", 0],
        ["https://other.test/report.csv", true, "outside the scope", 0],
        ["/attachment/fresh.csv", false, "outside the scope", 0],
        ["/attachment/login.csv", true, "could not verify the file", 1],
        ["/attachment/redirect.csv", true, "could not verify the file", 1],
        ["/attachment/renamed.csv", true, "expected filename", 1],
        ["/attachment/changed.csv", true, "changed during verification", 1],
        ["/attachment/fresh.csv", true, "pass", 1],
      ] as const) {
        await page.reload();
        await page.evaluate(`(() => {
          const receipt = document.querySelector("#attached-report");
          const path = ${JSON.stringify(path)};
          let href = path;
          if (path === "revoked-blob") {
            href = URL.createObjectURL(new Blob(["gone"], { type: "text/csv" }));
            URL.revokeObjectURL(href);
          }
          receipt.setAttribute("href", href);
          receipt.setAttribute("download", "qa-report-December.csv");
          receipt.setAttribute("aria-label", "Monthly report attachment");
          document.querySelector("#report-draft").addEventListener(
            "submit",
            (event) => {
              event.preventDefault();
              event.stopImmediatePropagation();
              receipt.removeAttribute("hidden");
            },
            { capture: true },
          );
        })()`);
        const beforeRequests = requests;
        const outcome = await replayDecember(allowWebsite);
        expect(requests - beforeRequests, path).toBe(attempts);
        const filenameOnly = await page.evaluate(
          browserQuickActionProbe(report.origin, {
            ...report.outcome,
            action: "assertVisible",
            expectedFilename: "qa-report-December.csv",
          }),
        );
        expect(filenameOnly, path).toBe("ok");
        filenameOnlyAccepted++;
        if (expected === "pass") {
          expect(outcome).toMatchObject({ status: "pass", fileReceipt: result.fileReceipt });
          filesVerified++;
        } else {
          expect(outcome).toMatchObject({
            status: "paused",
            completedSteps: 3,
            message: expect.stringContaining(expected),
          });
          expect(outcome.fileReceipt).toBeUndefined();
        }
      }
      console.info(
        JSON.stringify({
          fixture: "quick-action-file-results",
          filenameOnlyAccepted,
          filesVerified,
        }),
      );
    } finally {
      await browser?.close();
      await site.close();
    }
  },
  60_000,
);
