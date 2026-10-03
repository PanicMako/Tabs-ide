const { execSync, spawn } = require("child_process");
execSync('pkill -9 -f "@tabs/desktop" || true');
const child = spawn("node_modules/.bin/turbo", ["run", "dev", "--filter=@tabs/desktop"]);
child.on("exit", (code, signal) => console.log(code, signal));
