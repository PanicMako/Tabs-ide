import type { DeviceToolVersions } from "@tabs/contracts";

export function deviceToolVersionLabels(tools: DeviceToolVersions | undefined): string[] {
  if (!tools) return ["Device tool versions have not been checked."];
  return (
    [
      ["Device hub", tools.hub],
      ["Agent tools", tools.agent],
    ] as const
  ).map(([name, tool]) => {
    const installed = tool.installedVersions.length ? tool.installedVersions.join(", ") : "none";
    return `${name}: installed ${installed}; required ${tool.requiredVersion}${tool.runningVersion ? `; running ${tool.runningVersion}` : ""}.`;
  });
}

export function deviceToolUpdatePolicy(tools: DeviceToolVersions | undefined): string {
  if (!tools) return "Versions have not been checked. Check versions to compare them.";
  const outdated = [tools.hub, tools.agent].some(
    (tool) =>
      tool.installedVersions.length > 0 && !tool.installedVersions.includes(tool.requiredVersion),
  );
  return outdated
    ? "Update pending. Required tools install automatically when next used; the host needs network access."
    : "Required tools install automatically when needed. Checking versions installs and starts nothing.";
}

/** Node 22.12 or newer is required on SSH hosts. */
export function nodeMeetsSshRequirement(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}
