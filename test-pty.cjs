const pty = require("node-pty");
const ptyProcess = pty.spawn("zsh", [], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env,
});
ptyProcess.onData((data) => {
  console.log(data);
});
ptyProcess.write("npm run dev\r");
setTimeout(() => {
  const { execSync } = require("child_process");
  try {
    const stdout = execSync(`pgrep -P ${ptyProcess.pid}`).toString();
    console.log("pgrep -P output:", stdout);
  } catch (e) {
    console.error("pgrep error:", e.message);
  }
  process.exit(0);
}, 3000);
