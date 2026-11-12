// Pure logic: runs in a fresh sandbox per call, with no host access.
const TIPS = [
  "Press the Quick Actions shortcut and choose Waiting for you to see every agent question.",
  "Choose While you were away in Quick Actions to catch up after a break.",
  "Send a page error to the agent with the chip in the browser toolbar.",
  "Rest idle project browsers from Settings > Labs to save memory.",
];

function run(call) {
  if (!call || call.commandId !== "tip") throw new Error("Unknown command.");
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}
