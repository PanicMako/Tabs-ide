import { createHash } from "node:crypto";
import { describe, expect, it, onTestFinished } from "vitest";
import { screenshotReceiptExpression } from "./deviceScreenshotInput";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe.skipIf(process.env.TABS_QA_BROWSER !== "1")("generic screenshot image receipt", () => {
  async function open(html: (digest: string) => string, serveImage: boolean, meta = "") {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    onTestFinished(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<body style="background: orange">');
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: 8, height: 8 },
    });
    const digest = sha256(png);
    await page.route("https://app.test/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/anything/uploaded.png")
        return serveImage
          ? route.fulfill({ contentType: "image/png", body: png })
          : route.fulfill({ status: 404 });
      return route.fulfill({
        contentType: "text/html",
        body: `${meta}<body>${html(digest)}</body>`,
      });
    });
    await page.goto("https://app.test/notes/7");
    await page.waitForLoadState("load");
    return { page, digest };
  }
  const check = (page: import("playwright").Page, digest: string) =>
    page.evaluate(screenshotReceiptExpression([digest]));

  it("verifies an image shown at an arbitrary same-origin URL without any convention", async () => {
    const { page, digest } = await open(
      () => '<img src="/anything/uploaded.png" width="8" height="8">',
      true,
    );
    await expect(check(page, digest)).resolves.toBe(true);
  });

  it("does not verify a page that only prints the digest", async () => {
    const { page, digest } = await open(
      (value) => `<p>${value}</p><img src="/anything/uploaded.png" width="8" height="8">`,
      false,
    );
    await expect(check(page, digest)).resolves.toBe(false);
    const none = await open((value) => `<p>${value}</p>`, true);
    await expect(check(none.page, none.digest)).resolves.toBe(false);
  });

  it("ignores hidden images and images of other bytes", async () => {
    const hidden = await open(
      () => '<img src="/anything/uploaded.png" style="display:none" width="8" height="8">',
      true,
    );
    await expect(check(hidden.page, hidden.digest)).resolves.toBe(false);
    const other = await open(() => '<img src="/anything/uploaded.png" width="8" height="8">', true);
    await expect(check(other.page, "0".repeat(64))).resolves.toBe(false);
  });
});
