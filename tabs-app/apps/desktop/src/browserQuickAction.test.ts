import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { BrowserQuickAction } from "@tabs/contracts";
import { prepareBrowserQuickActionValues } from "@tabs/shared/browserQuickAction";
import {
  replayBrowserQuickAction,
  revealBrowserQuickActionFile,
  validatedBrowserQuickAction,
} from "./browserQuickAction";
import { browserQuickActionPicker } from "./browserQuickActionDom";
import { JourneyRecorder } from "./journeyRecorder";

const origin = "http://quick-action.test";
const action: BrowserQuickAction = {
  id: crypto.randomUUID(),
  origin,
  label: "Create report",
  steps: [
    { action: "fill", selector: "#month", tag: "input", parameter: "report_month" },
    { action: "click", selector: ".send", tag: "button" },
  ],
  outcome: { selector: "#done", description: "Report created" },
};
const fixture = `
  <input id="month">
  <input id="contact" type="password">
  <button class="send" id="create" onpointerdown="document.querySelector('#wrong-action').hidden = false" onclick="document.querySelector('#done').hidden = false">Create</button>
  <button class="send" id="wrong" onclick="document.querySelector('#wrong-action').hidden = false">Wrong</button>
  <p id="done" hidden>Created</p>
  <p id="wrong-action" hidden>Wrong action ran</p>
  <script>
    window.addEventListener("input", () => document.body.dataset.inputs = Number(document.body.dataset.inputs || 0) + 1);
  </script>
`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function usingPage(test: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  try {
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: fixture }),
    );
    await page.goto(`${origin}/draft?private=recording-secret#personal`);
    await test(page);
  } finally {
    await page.close();
  }
}

function driver(page: Page) {
  return {
    executeJavaScriptInIsolatedWorld: (_world: number, scripts: Electron.WebSource[]) =>
      page.evaluate(scripts[0]!.code),
  };
}

it("stops before either matching button and continues with the picked replacement", async () => {
  await usingPage(async (page) => {
    const checkControl = () => {};
    const first = await replayBrowserQuickAction(
      driver(page),
      action,
      new Map([["report_month", "November"]]),
      0,
      checkControl,
    );
    expect(first).toMatchObject({ status: "paused", completedSteps: 1 });
    expect(await page.locator("#done").isVisible()).toBe(false);
    expect(await page.locator("#wrong-action").isVisible()).toBe(false);
    expect(await page.locator("#month").inputValue()).toBe("November");

    const choice = page.evaluate(browserQuickActionPicker(origin));
    await page.getByText("Choose the control").waitFor();
    await page.locator("#create").click();
    expect(await page.locator("#done").isVisible()).toBe(false);
    expect(await page.locator("#wrong-action").isVisible()).toBe(false);
    const target = (await choice) as { selector: string; tag: string };
    expect(target).toEqual({
      selector: "#create",
      tag: "button",
      semantic: { role: "button", name: "Create" },
    });

    const repaired = {
      ...action,
      steps: [action.steps[0]!, { action: "click" as const, ...target }],
    };
    const resumed = await replayBrowserQuickAction(
      driver(page),
      repaired,
      new Map(),
      first.completedSteps,
      checkControl,
    );
    expect(resumed).toEqual({ status: "pass", completedSteps: 2, message: "Report created" });
    expect(await page.locator("body").getAttribute("data-inputs")).toBe("1");
    expect(await page.locator("#wrong-action").isVisible()).toBe(false);
    expect(await page.locator("#done").isVisible()).toBe(true);
  });
});

const redesignedAction: BrowserQuickAction = {
  ...action,
  steps: [
    {
      action: "click",
      selector: "#old-export",
      tag: "button",
      semantic: { role: "button", name: "Export", group: "Selected rows" },
    },
  ],
  outcome: {
    selector: "",
    semantic: { role: "status", name: "Report ready" },
    description: "Report created",
  },
};

it.each([
  { variation: "moves and replaces the control", decoy: "", passes: true },
  {
    variation: "reuses the selector for a different action",
    decoy:
      '<button id="old-export" onclick="document.body.dataset.result=\'wrong\'">Remove</button>',
    passes: false,
  },
  {
    variation: "duplicates the semantic target",
    decoy: "<button onclick=\"document.body.dataset.result='wrong'\">Export</button>",
    passes: false,
  },
])("checks the current page when a redesign $variation", async ({ decoy, passes }) => {
  await usingPage(async (page) => {
    await page.setContent(`
      <section aria-label="All reports"><button onclick="document.body.dataset.result='wrong'">Export</button></section>
      <section aria-label="Selected rows"><form>
        <span role="button" tabindex="0" onclick="document.body.dataset.result='selected'; document.querySelector('output').hidden=false">Export</span>
        ${decoy}
      </form></section>
      <output aria-label="Report ready" hidden>Completed</output>
    `);
    const result = await replayBrowserQuickAction(
      driver(page),
      validatedBrowserQuickAction(redesignedAction),
      new Map(),
      0,
      () => {},
    );
    expect(result).toMatchObject({
      status: passes ? "pass" : "paused",
      completedSteps: passes ? 1 : 0,
    });
    expect(await page.locator("body").getAttribute("data-result")).toBe(passes ? "selected" : null);
  });
});

it("keeps protected values, covered targets and stale outcomes from driving input", async () => {
  await usingPage(async (page) => {
    const values = new Map([["report_month", "never-write"]]);
    const checkControl = () => {};
    const protectedAction = {
      ...action,
      steps: [{ ...action.steps[0]!, selector: "#contact" }],
    };
    const blocked = await replayBrowserQuickAction(
      driver(page),
      protectedAction,
      values,
      0,
      checkControl,
    );
    expect(blocked).toMatchObject({ status: "paused", completedSteps: 0 });
    expect(await page.locator("#contact").inputValue()).toBe("");
    await page.locator("#done").evaluate((element: HTMLElement) => {
      element.hidden = false;
    });
    const stale = await replayBrowserQuickAction(driver(page), action, values, 0, checkControl);
    expect(stale).toMatchObject({
      status: "fail",
      completedSteps: 0,
      message: expect.stringContaining("already visible"),
    });
    expect(await page.locator("#month").inputValue()).toBe("");
    await page.locator("#done").evaluate((element: HTMLElement) => {
      element.hidden = true;
    });
    await page.evaluate(() => {
      const cover = document.createElement("div");
      cover.style.cssText = "position:fixed; inset:0; z-index:9999";
      document.body.append(cover);
    });
    const covered = await replayBrowserQuickAction(driver(page), action, values, 0, checkControl);
    expect(covered).toMatchObject({
      status: "paused",
      completedSteps: 0,
      message: expect.stringContaining("covered"),
    });
    expect(await page.locator("#month").inputValue()).toBe("");
  });
});

it("collects structural metadata in an isolated recording and drops values and private routes", async () => {
  await usingPage(async (page) => {
    const cdp = await page.context().newCDPSession(page);
    const emitter = Object.assign(new EventEmitter(), {
      isAttached: () => false,
      attach: () => {},
      sendCommand: cdp.send.bind(cdp),
    });
    cdp.on("Runtime.bindingCalled", (event) =>
      emitter.emit("message", {}, "Runtime.bindingCalled", event),
    );
    const contents = Object.assign(new EventEmitter(), {
      debugger: emitter,
      getURL: () => page.url(),
      isDestroyed: () => page.isClosed(),
    });
    const recorder = new JourneyRecorder(contents as unknown as WebContents);
    await recorder.start(true);
    await page.locator("#month").fill("secret typed value");
    await page.locator("#contact").fill("secret password");
    await page.locator("#create").click();
    await expect.poll(() => recorder.status().count).toBe(2);
    const output = await recorder.stop();
    expect(output.initialUrl).toBe(origin);
    expect(output.steps).toMatchObject([
      { action: "fill", selector: "#month", tag: "input" },
      {
        action: "click",
        selector: "#create",
        tag: "button",
        semantic: { role: "button", name: "Create" },
      },
    ]);
    expect(JSON.stringify(output)).not.toMatch(/secret|password|private=|personal/);
  });
});

it("decodes only the reviewed shape and materializes the remaining required parameters", () => {
  const decoded = validatedBrowserQuickAction({
    ...action,
    steps: [{ ...action.steps[0], value: "old-demo-value" }, action.steps[1]],
  });
  expect(decoded.steps[0]).not.toHaveProperty("value");
  expect(() => prepareBrowserQuickActionValues(decoded, {})).toThrow("parameters");
  expect(prepareBrowserQuickActionValues(decoded, {}, 1).size).toBe(0);
  expect(() =>
    validatedBrowserQuickAction({
      ...action,
      steps: [{ ...action.steps[0], parameter: "password" }],
    }),
  ).toThrow("credential");
});

it("validates filename templates against the selected inputs and rejects invalid substitutions", () => {
  const withFilename = (filenamePattern: string) => ({
    ...action,
    outcome: { ...action.outcome, filenamePattern },
  });
  expect(() => validatedBrowserQuickAction(withFilename("qa-{other}.csv"))).toThrow(
    "selected input steps",
  );
  for (const filename of ["qa-{{report_month}}.csv", "qa-{report_month.csv", "../qa.csv"]) {
    expect(() => validatedBrowserQuickAction(withFilename(filename))).toThrow("filename");
  }
  const templated = validatedBrowserQuickAction(withFilename("qa-{report_month}.csv"));
  for (const report_month of ["../../secret", "first\nsecond", "a".repeat(240)]) {
    expect(() => prepareBrowserQuickActionValues(templated, { report_month })).toThrow(
      "valid expected filename",
    );
  }
  expect(() => prepareBrowserQuickActionValues(templated, {}, 1)).toThrow("expected filename");
  expect(
    prepareBrowserQuickActionValues(
      templated,
      { report_month: "unreviewed" },
      1,
      new Map([["report_month", "December"]]),
    ).get("report_month"),
  ).toBe("December");
  const literal = validatedBrowserQuickAction(withFilename("qa-report.csv"));
  expect(prepareBrowserQuickActionValues(literal, {}, 1).size).toBe(0);
});

it.each(["click", "verification"])(
  "rejects a preexisting same-name archive and recovers the new file after one export and a lost %s reply",
  async (lostReply) => {
    await usingPage(async (page) => {
      let exports = 0;
      await page.route(`${origin}/export`, (route) => {
        expect(route.request().method()).toBe("POST");
        exports++;
        return route.fulfill({ contentType: "text/csv", body: "current" });
      });
      await page.setContent(`
      <a id="archive" download="report.csv" href="data:text/csv,archived">Archive</a>
      <button id="export">Export</button>
      <script>
        document.querySelector("#export").onclick = async () => {
          const bytes = await (await fetch("/export", { method: "POST" })).text();
          const result = document.createElement("a");
          result.id = "new-report";
          result.download = "report.csv";
          result.href = "data:text/csv," + encodeURIComponent(bytes);
          result.textContent = "Current report";
          document.body.append(result);
        };
      </script>
    `);
      const report: BrowserQuickAction = {
        ...action,
        steps: [{ action: "click", selector: "#export" }],
        outcome: {
          selector: "#old-report",
          description: "Report ready",
          filenamePattern: "report.csv",
        },
      };
      const values = new Map<string, string>();
      const checkControl = () => {};
      const first = await replayBrowserQuickAction(
        {
          async executeJavaScriptInIsolatedWorld(world, scripts) {
            const reply = await driver(page).executeJavaScriptInIsolatedWorld(world, scripts);
            const marker =
              lostReply === "click"
                ? '"action":"click"'
                : '"verifyFile":{"allowWebsiteDownloads":false}';
            if (scripts[0]!.code.includes(marker)) throw new Error("Lost browser reply");
            return reply;
          },
        },
        report,
        values,
        0,
        checkControl,
      );
      await page.locator("#new-report").waitFor();
      expect(exports).toBe(1);
      const replayOutcome = (selector: string) =>
        replayBrowserQuickAction(
          driver(page),
          { ...report, outcome: { ...report.outcome, selector } },
          values,
          report.steps.length,
          checkControl,
          false,
          first.fileBaseline,
        );
      expect(await replayOutcome("#archive")).toMatchObject({
        status: "paused",
        completedSteps: 1,
        message: expect.stringContaining("before this run"),
      });
      expect(first).toMatchObject({ status: "paused", completedSteps: 1 });
      await page.locator("#archive").evaluate((archive: HTMLAnchorElement) => {
        archive.href = "data:text/csv;base64,YXJjaGl2ZWQ=";
      });
      expect(await replayOutcome("#archive")).toMatchObject({ status: "paused" });
      expect(await replayOutcome("#new-report")).toMatchObject({
        status: "pass",
        completedSteps: 1,
        fileReceipt: {
          filename: "report.csv",
          byteLength: 7,
          sha256: createHash("sha256").update("current").digest("hex"),
        },
      });
      expect(exports).toBe(1);
    });
  },
);

it("rechecks a visible result after a lost verification reply without clicking again", async () => {
  await usingPage(async (page) => {
    await page.locator("#create").evaluate((button) => {
      button.addEventListener("click", () => {
        button.dataset.clicks = String(Number(button.dataset.clicks ?? 0) + 1);
      });
    });
    const report: BrowserQuickAction = {
      ...action,
      steps: [{ action: "click", selector: "#create" }],
    };
    const browser = driver(page);
    const values = new Map<string, string>();
    const checkControl = () => {};
    let clicked = false;
    const first = await replayBrowserQuickAction(
      {
        async executeJavaScriptInIsolatedWorld(world, scripts) {
          const result = await browser.executeJavaScriptInIsolatedWorld(world, scripts);
          if (scripts[0]!.code.includes('"action":"click"')) clicked = true;
          else if (clicked) throw new Error("Lost verification reply");
          return result;
        },
      },
      report,
      values,
      0,
      checkControl,
    );
    expect(first).toMatchObject({ status: "paused", completedSteps: 1 });
    expect(first).not.toHaveProperty("unconfirmedStep");
    await expect(
      replayBrowserQuickAction(browser, report, values, first.completedSteps, checkControl),
    ).resolves.toMatchObject({ status: "pass", completedSteps: 1 });
    expect(await page.locator("#create").getAttribute("data-clicks")).toBe("1");
  });
});

it("verifies a file on an HTTP page without exposing file data in the receipt", async () => {
  await usingPage(async (page) => {
    const text = "Area,Status\nCheckout,Passed";
    expect(await page.evaluate("typeof crypto.subtle")).toBe("undefined");
    await page.evaluate(`(() => {
      document.querySelector("#create").onclick = () => {
        const link = document.createElement("a");
        link.id = "report";
        link.download = "report.csv";
        link.href = "data:text/csv," + encodeURIComponent(${JSON.stringify(text)});
        link.textContent = "Report";
        link.style.cssText = "display:block;margin-top:1400px";
        document.body.append(link);
      };
    })()`);
    const report = {
      ...action,
      steps: [{ action: "click" as const, selector: "#create" }],
      outcome: { selector: "#report", description: "Report ready", filenamePattern: "report.csv" },
    };
    const result = await replayBrowserQuickAction(driver(page), report, new Map(), 0, () => {});
    expect(result).toEqual({
      status: "pass",
      completedSteps: report.steps.length,
      message: "Report ready",
      fileReceipt: {
        filename: "report.csv",
        byteLength: Buffer.byteLength(text),
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    });
    const receipt = result.fileReceipt;
    if (!receipt) throw new Error("Missing file receipt");
    const reveal = () =>
      revealBrowserQuickActionFile(
        (expression) => page.evaluate(expression),
        { action: report, receipt },
        false,
      );
    await reveal();
    expect(await page.evaluate("scrollY")).toBeGreaterThan(0);
    await page.evaluate(
      `scrollTo(0, 0); document.querySelector("#report").href = "data:text/csv,other";`,
    );
    await expect(reveal()).rejects.toThrow("changed or is unavailable");
    expect(await page.evaluate("scrollY")).toBe(0);
    await page.evaluate(
      `document.querySelector("#report").href = "data:text/csv," + encodeURIComponent(${JSON.stringify(text)});`,
    );
    await expect(
      revealBrowserQuickActionFile(
        async (expression) => {
          if (expression.includes('"revealFileToken":'))
            await page.evaluate('document.querySelector("#report").href = "data:text/csv,other"');
          return page.evaluate(expression);
        },
        { action: report, receipt },
        false,
      ),
    ).rejects.toThrow("changed or is unavailable");
    expect(await page.evaluate("scrollY")).toBe(0);
  });
});
