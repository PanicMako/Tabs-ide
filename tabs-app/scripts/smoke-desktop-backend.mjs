import { readFile } from "node:fs/promises";

const [desktopLogPath, serverLogPath] = process.argv.slice(2);
if (!desktopLogPath || !serverLogPath) {
  console.error("Usage: node smoke-desktop-backend.mjs desktop-main.log server-child.log");
  process.exit(2);
}

const nativeBackendMarker = "bootstrap native Code-OSS main-process backend started";
const sessionStart = /---- APP SESSION START run=([^\s]+)/g;
const sessionEnd = /---- APP SESSION END run=([^\s]+)/g;
const timeoutAt = Date.now() + 30_000;
let lastError = "No desktop backend logs were written.";

async function readLog(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function matches(text, expression) {
  return [...text.matchAll(expression)];
}

function sessionIsHealthy(text) {
  const starts = matches(text, sessionStart);
  const ends = matches(text, sessionEnd);
  return starts.length === 1 && ends.length === 0;
}

function resolvePort(text) {
  const entries = [
    ...text.matchAll(/bootstrap resolved websocket endpoint baseUrl=ws:\/\/127\.0\.0\.1:(\d+)/g),
  ];
  return entries.length === 0 ? undefined : Number(entries.at(-1)[1]);
}

async function verifyHttpHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Environment descriptor returned HTTP ${response.status}.`);
  const descriptor = await response.json();
  if (
    !descriptor ||
    typeof descriptor.environmentId !== "string" ||
    typeof descriptor.serverVersion !== "string" ||
    typeof descriptor.label !== "string"
  ) {
    throw new Error("Environment descriptor did not contain the expected workspace fields.");
  }
}

async function waitForBackend() {
  while (Date.now() < timeoutAt) {
    const [desktopLog, serverLog] = await Promise.all([
      readLog(desktopLogPath),
      readLog(serverLogPath),
    ]);
    const port = resolvePort(desktopLog);

    if (!desktopLog.includes(nativeBackendMarker)) {
      lastError = "The desktop Code-OSS backend readiness marker has not appeared.";
    } else if (port === undefined) {
      lastError = "The desktop did not log its loopback workspace backend port.";
    } else if (!sessionIsHealthy(serverLog)) {
      const starts = matches(serverLog, sessionStart).length;
      const ends = matches(serverLog, sessionEnd).length;
      lastError = `Expected one active workspace server process, found ${starts} starts and ${ends} exits.`;
    } else {
      try {
        await verifyHttpHealth(port);
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const [stableDesktopLog, stableServerLog] = await Promise.all([
          readLog(desktopLogPath),
          readLog(serverLogPath),
        ]);
        if (!stableDesktopLog.includes(nativeBackendMarker)) {
          throw new Error("The desktop Code-OSS backend stopped before the stability check.");
        }
        if (!sessionIsHealthy(stableServerLog)) {
          throw new Error("The workspace server restarted during the stability check.");
        }
        await verifyHttpHealth(port);
        console.log(
          "Packaged workspace backend returned a valid environment descriptor and remained stable.",
        );
        return;
      } catch (error) {
        lastError = error.message;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const [desktopLog, serverLog] = await Promise.all([
    readLog(desktopLogPath),
    readLog(serverLogPath),
  ]);
  console.error(`Workspace backend smoke failed: ${lastError}`);
  console.error(`Desktop log tail:\n${desktopLog.split("\n").slice(-50).join("\n")}`);
  console.error(`Server log tail:\n${serverLog.split("\n").slice(-80).join("\n")}`);
  process.exitCode = 1;
}

await waitForBackend();
