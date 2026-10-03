import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { BrowserReproductionStep } from "@tabs/contracts";
import { runBrowserReproduction, type ReproductionDriver } from "./browserReproductionRunner";

let browser: Browser | undefined;
beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.warn("Chromium is not installed; skipping reproduction runner tests:", error);
  }
});
afterAll(async () => {
  await browser?.close();
});
beforeEach((context) => {
  if (!browser) {
    context.skip();
  }
});
const fixture = `<input id="name"><input id="password" type="password"><select id="choice"><option value="a">A</option><option value="b">B</option></select><input id="check" type="checkbox"><button id="button" onclick="document.querySelector('#result').textContent='Done'">Go</button><div id="result">Waiting</div><div id="hidden" style="display:none">Done</div>`;
function driver(page: Page): ReproductionDriver {
  return {
    checkControl() {},
    async navigate(url) {
      await page.goto(url);
    },
    evaluate: (expression) => page.evaluate(expression),
    click: (selector) => page.locator(selector).click(),
    fill: (selector, value) => page.locator(selector).fill(value),
    press: (key) => page.keyboard.press(key),
  };
}
async function withPage(run: (page: Page) => Promise<void>) {
  if (!browser) throw new Error("Chromium browser is not available");
  const page = await browser.newPage();
  await page.route("http://reproduction.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  try {
    await run(page);
  } finally {
    await page.close();
  }
}
const step = (
  action: BrowserReproductionStep["action"],
  selector: string,
  rest = {},
): BrowserReproductionStep => ({ id: crypto.randomUUID(), action, selector, ...rest });

describe("reproduction runner against Chromium", () => {
  it("executes every action and exact assertion, including selection and checkbox state", async () => {
    await withPage(async (page) => {
      const result = await runBrowserReproduction(
        driver(page),
        "http://reproduction.test/",
        [
          step("goto", "", { url: "http://reproduction.test/form" }),
          step("fill", "#name", { value: "Alice" }),
          step("press", "#name", { key: "Tab" }),
          step("selectOption", "#choice", { value: "b" }),
          step("check", "#check"),
          step("uncheck", "#check"),
          step("click", "#button"),
          step("assertVisible", "#result"),
          step("assertText", "#result", { expectedValue: "Done" }),
          step("assertValue", "#name", { expectedValue: "Alice" }),
          step("assertValue", "#choice", { expectedValue: "b" }),
        ],
        {},
      );
      expect(result).toMatchObject({ status: "pass", completedSteps: 11, passedAssertions: 4 });
      expect(await page.locator("#check").isChecked()).toBe(false);
    });
  });
  it.each([
    step("assertVisible", "#hidden"),
    step("assertText", "#result", { expectedValue: "Done" }),
    step("assertValue", "#name", { expectedValue: "Alice" }),
  ])("fails a mismatching $action without accepting body-wide matches", async (assertion) => {
    await withPage(async (page) => {
      const result = await runBrowserReproduction(
        driver(page),
        "http://reproduction.test/",
        [assertion],
        {},
        100,
      );
      expect(result).toMatchObject({ status: "fail", passedAssertions: 0, completedSteps: 0 });
    });
  });
  it("validates all parameters before navigating, and does not leak secrets into errors", async () => {
    await withPage(async (page) => {
      const result = await runBrowserReproduction(
        driver(page),
        "http://reproduction.test/",
        [step("fill", "#password", { value: "private-secret" }), step("assertVisible", "#result")],
        {},
      );
      expect(result.status).toBe("not_verified");
      expect(result.message).not.toContain("private-secret");
      expect(page.url()).toBe("about:blank");
    });
  });
  it("stops after human preemption before executing the next action", async () => {
    await withPage(async (page) => {
      const base = driver(page);
      let interrupted = false;
      const result = await runBrowserReproduction(
        {
          ...base,
          checkControl() {
            if (interrupted) throw new Error("human takeover");
          },
          async fill(selector, value) {
            await base.fill(selector, value);
            interrupted = true;
          },
        },
        "http://reproduction.test/",
        [
          step("fill", "#name", { value: "Alice" }),
          step("click", "#button"),
          step("assertText", "#result", { expectedValue: "Done" }),
        ],
        {},
      );
      expect(result.status).toBe("interrupted");
      expect(await page.locator("#result").textContent()).toBe("Waiting");
    });
  });
});
