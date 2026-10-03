import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "Pass the URL of a running built-site preview.");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("https://api.github.com/**", (route) => route.abort());
  for (const path of ["/", "/downloads", "/changelog", "/community"]) {
    await page.goto(new URL(path, baseUrl).href);
    await page.evaluate(() => document.fonts.ready);
    const buttons = page.locator(".hs-nav-download, .platform-download");
    assert.ok(await buttons.count(), `No download controls on ${path}`);
    for (const button of await buttons.all()) {
      await button.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const offset = () =>
        button.evaluate((el) => {
          const icon = el.querySelector("svg").getBoundingClientRect();
          const rect = el.getBoundingClientRect();
          return icon.y + icon.height / 2 - (rect.y + rect.height / 2);
        });
      const before = await offset();
      await button.hover();
      await page.waitForTimeout(700);
      assert.ok(Math.abs((await offset()) - before) < 0.5, `Download icon moves on hover: ${path}`);
    }
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarColor),
      "rgb(145, 167, 223) rgb(240, 244, 252)",
      `Scrollbar palette missing on ${path}`,
    );
  }
  await page.goto(new URL("/community", baseUrl).href);
  assert.equal(await page.locator(".topic-card").count(), 3);
  assert.equal(await page.locator(".topic-start").count(), 3);
  assert.equal(
    await page.locator(".community-primary").getAttribute("href"),
    "https://github.com/PanicMako/Tabs-ide/discussions",
  );
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Community overflows at ${width}px`,
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".hs-nav-download").hover();
  assert.equal(
    await page.locator(".hs-nav-download").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(50, 89, 237)",
    "Reduced-motion hover loses its blue background",
  );
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/tabs-community-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/tabs-community-mobile.png", fullPage: true });
  console.log(
    "Verified hover alignment, scrollbar palette, community links, and responsive widths.",
  );
} finally {
  await browser.close();
}
