const CDP = require("chrome-remote-interface");

async function check() {
  let client;
  try {
    client = await CDP({ port: 9222 });
    const { DOM } = client;
    await DOM.enable();
    const { root } = await DOM.getDocument({ depth: -1 });
    const domString = JSON.stringify(root);

    if (
      domString.includes("Creating development workspace") ||
      domString.includes("Loading workspace")
    ) {
      console.log("DOM check: Splash screen is currently VISIBLE.");
      process.exit(0);
    } else {
      console.log("DOM check: Splash screen is NOT visible (healthy).");
      process.exit(1);
    }
  } catch (err) {
    console.error("CDP Error:", err.message);
    // If it fails to connect, we don't know if it's stuck or not. Exit 1 to continue loop.
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}
check();
