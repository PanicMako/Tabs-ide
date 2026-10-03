const { chromium } = require("playwright");
(async () => {
  try {
    console.log("Connecting to Chromium...");
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0];
    console.log("Connected to Electron UI. URL:", page.url());

    // Switch to Agents tab if not there
    try {
      const agentsTab = await page.locator('text="Agents"');
      if (await agentsTab.isVisible()) {
        await agentsTab.click();
      }
    } catch (e) {
      console.log("Could not find Agents tab, assuming we are there.");
    }

    await page.waitForTimeout(2000);

    // Find the textarea and send a message
    console.log("Waiting for textarea...");
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 15000 });
    await textarea.fill("Hello from playwright test");
    await textarea.press("Enter");

    console.log("Turn sent, waiting for result...");
    await page.waitForTimeout(5000); // Wait 5s for any crashes

    // Check if there is an error message visible about "Provider turn start failed" or similar
    const errorMsg = page.locator('text="Provider turn start failed"');
    if (await errorMsg.isVisible()) {
      console.error("ERROR REPRODUCED: Provider turn start failed.");
      process.exit(1);
    }

    console.log("Turn did not crash the UI. Success.");
    process.exit(0);
  } catch (e) {
    console.error("Playwright Error:", e);
    process.exit(1);
  }
})();
