import type { TabsExtensionAssignment, TabsExtensionManifest } from "@tabs/contracts";
import { TABS_EXTENSION_API_VERSION } from "@tabs/extension-api";
import { compareSemverVersions, parseSemver, satisfiesSemverRange } from "./semver.ts";

const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;
const MAX_TOOLS = 12;
const MAX_COMMANDS = 8;

export function extensionPermissionIncrease(
  next: TabsExtensionManifest,
  previous?: TabsExtensionManifest,
): {
  readonly addedCapabilities: ReadonlyArray<
    NonNullable<TabsExtensionManifest["capabilities"]>[number]
  >;
  readonly addedNetworkHosts: ReadonlyArray<string>;
  readonly addedAiTools: ReadonlyArray<string>;
} {
  return {
    addedCapabilities: (next.capabilities ?? []).filter(
      (capability) => !previous?.capabilities?.includes(capability),
    ),
    addedNetworkHosts: (next.networkHosts ?? []).filter(
      (host) => !previous?.networkHosts?.includes(host),
    ),
    addedAiTools: (next.contributes.commands ?? [])
      .filter(
        (command) =>
          command.aiCallable === true &&
          !previous?.contributes.commands?.some(
            (prior) => prior.id === command.id && prior.aiCallable === true,
          ),
      )
      .map((command) => command.id),
  };
}

export type ManifestValidationResult =
  | { readonly ok: true; readonly manifest: TabsExtensionManifest; readonly id: string }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePackagePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 240) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  if (/[?:#%]/.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function safePublisherUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value !== value.trim() ||
    Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character === "\u007f")
  )
    return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function apiRangeIsSafe(range: string, minimum: string): boolean {
  return range.split("||").every((group) =>
    group
      .trim()
      .split(/\s+/)
      .some((comparator) => {
        const match = /^(\^|>=|>|=)?v?(\d+(?:\.\d+){0,2})$/.exec(comparator);
        if (!match || !["^", ">=", ">", "="].includes(match[1] ?? "=")) return false;
        return compareSemverVersions(match[2]!, minimum) >= 0;
      }),
  );
}

/** Validate packaged contributions before they reach the desktop host. */
export function validateTabsExtensionManifest(
  input: unknown,
  tabsVersion: string,
): ManifestValidationResult {
  const errors: string[] = [];
  if (!record(input)) return { ok: false, errors: ["Manifest must be a JSON object."] };
  const allowed = new Set([
    "manifestVersion",
    "publisher",
    "name",
    "version",
    "displayName",
    "description",
    "releaseNotes",
    "sourceUrl",
    "supportUrl",
    "privacyUrl",
    "engines",
    "networkHosts",
    "logic",
    "capabilities",
    "contributes",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`Unsupported manifest field: ${key}`);
  }
  if (input.manifestVersion !== 1) errors.push("manifestVersion must be 1.");
  if (typeof input.publisher !== "string" || !SEGMENT.test(input.publisher)) {
    errors.push("publisher must be a lowercase namespace.");
  }
  if (typeof input.name !== "string" || !SEGMENT.test(input.name)) {
    errors.push("name must be a lowercase package name.");
  }
  if (typeof input.version !== "string" || !parseSemver(input.version)) {
    errors.push("version must be semantic versioning.");
  }
  for (const key of ["displayName", "description"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 500) {
      errors.push(`${key} must be nonempty and at most 500 characters.`);
    }
  }
  if (
    input.releaseNotes !== undefined &&
    (typeof input.releaseNotes !== "string" || input.releaseNotes.length > 10_000)
  ) {
    errors.push("releaseNotes must be plain text of at most 10000 characters.");
  }
  for (const key of ["sourceUrl", "supportUrl", "privacyUrl"] as const) {
    if (input[key] !== undefined && !safePublisherUrl(input[key])) {
      errors.push(`${key} must be an HTTPS URL without credentials, at most 2048 characters.`);
    }
  }
  const engines = input.engines;
  if (
    !record(engines) ||
    typeof engines.tabs !== "string" ||
    !satisfiesSemverRange(tabsVersion, engines.tabs)
  ) {
    errors.push(`engines.tabs must include this Tabs version (${tabsVersion}).`);
  } else if (Object.keys(engines).some((key) => key !== "tabs" && key !== "api")) {
    errors.push("engines has unsupported fields.");
  }
  if (
    record(engines) &&
    engines.api !== undefined &&
    (typeof engines.api !== "string" ||
      !satisfiesSemverRange(TABS_EXTENSION_API_VERSION, engines.api))
  ) {
    errors.push(
      `engines.api must include the current extension API (${TABS_EXTENSION_API_VERSION}).`,
    );
  }
  const contributes = input.contributes;
  if (input.logic !== undefined) {
    if (
      !record(input.logic) ||
      Object.keys(input.logic).some((key) => key !== "entry") ||
      !safePackagePath(input.logic.entry) ||
      !input.logic.entry.endsWith(".js")
    ) {
      errors.push("logic.entry must be a relative packaged JavaScript file.");
    }
    if (
      !record(engines) ||
      typeof engines.api !== "string" ||
      !apiRangeIsSafe(engines.api, "1.2.0")
    ) {
      errors.push("logic commands require engines.api to start at 1.2.0 or later.");
    }
  }
  if (input.networkHosts !== undefined) {
    if (
      !Array.isArray(input.networkHosts) ||
      input.networkHosts.length < 1 ||
      input.networkHosts.length > 8 ||
      new Set(input.networkHosts).size !== input.networkHosts.length ||
      input.networkHosts.some(
        (host) =>
          typeof host !== "string" ||
          host.length > 253 ||
          !/^[a-z0-9.-]+$/.test(host) ||
          !host.includes(".") ||
          host.startsWith(".") ||
          host.endsWith(".") ||
          host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
      )
    )
      errors.push("networkHosts requires 1 to 8 unique DNS hostnames without wildcards.");
    if (!Array.isArray(input.capabilities) || !input.capabilities.includes("network")) {
      errors.push("networkHosts requires the network capability.");
    }
  } else if (Array.isArray(input.capabilities) && input.capabilities.includes("network")) {
    errors.push("network capability requires networkHosts.");
  }
  if (
    Array.isArray(input.capabilities) &&
    input.capabilities.includes("credentials") &&
    !input.capabilities.includes("network")
  ) {
    errors.push("credentials capability requires network.");
  }
  if (
    input.capabilities !== undefined &&
    (!Array.isArray(input.capabilities) ||
      input.capabilities.length > 5 ||
      new Set(input.capabilities).size !== input.capabilities.length ||
      input.capabilities.some(
        (capability) =>
          capability !== "profile-storage" &&
          capability !== "workspace-read" &&
          capability !== "network" &&
          capability !== "credentials" &&
          capability !== "ai-tools",
      ))
  ) {
    errors.push(
      "capabilities supports only profile-storage, workspace-read, network, credentials, and ai-tools without duplicates.",
    );
  }
  if (!record(contributes) || !Array.isArray(contributes.tools)) {
    errors.push("contributes.tools must be an array.");
  } else {
    if (Object.keys(contributes).some((key) => key !== "tools" && key !== "commands")) {
      errors.push("contributes has unsupported fields.");
    }
    if (contributes.tools.length < 1 || contributes.tools.length > MAX_TOOLS) {
      errors.push(`contributes.tools must contain 1 to ${MAX_TOOLS} tools.`);
    }
    const seen = new Set<string>();
    for (const [index, tool] of contributes.tools.entries()) {
      if (!record(tool)) {
        errors.push(`Tool ${index} must be an object.`);
        continue;
      }
      if (Object.keys(tool).some((key) => !["id", "label", "entry", "icon"].includes(key))) {
        errors.push(`Tool ${index} has unsupported fields.`);
      }
      if (typeof tool.id !== "string" || !SEGMENT.test(tool.id) || seen.has(tool.id)) {
        errors.push(`Tool ${index} needs a unique lowercase id.`);
      } else seen.add(tool.id);
      if (typeof tool.label !== "string" || !tool.label.trim() || tool.label.length > 80) {
        errors.push(`Tool ${index} needs a label of at most 80 characters.`);
      }
      if (!safePackagePath(tool.entry) || !tool.entry.endsWith(".html")) {
        errors.push(`Tool ${index} entry must be a relative packaged HTML file.`);
      }
      if (tool.icon !== undefined && (!safePackagePath(tool.icon) || !tool.icon.endsWith(".svg"))) {
        errors.push(`Tool ${index} icon must be a relative packaged SVG file.`);
      }
    }
    if (contributes.commands !== undefined) {
      if (
        !Array.isArray(contributes.commands) ||
        contributes.commands.length < 1 ||
        contributes.commands.length > MAX_COMMANDS
      ) {
        errors.push(`contributes.commands must contain 1 to ${MAX_COMMANDS} commands.`);
      } else {
        const commandIds = new Set<string>();
        for (const [index, command] of contributes.commands.entries()) {
          if (!record(command)) {
            errors.push(`Command ${index} must be an object.`);
            continue;
          }
          if (
            Object.keys(command).some(
              (key) => !["id", "label", "description", "aiCallable"].includes(key),
            )
          ) {
            errors.push(`Command ${index} has unsupported fields.`);
          }
          if (
            typeof command.id !== "string" ||
            !SEGMENT.test(command.id) ||
            commandIds.has(command.id)
          ) {
            errors.push(`Command ${index} needs a unique lowercase id.`);
          } else commandIds.add(command.id);
          if (
            typeof command.label !== "string" ||
            !command.label.trim() ||
            command.label.length > 80
          ) {
            errors.push(`Command ${index} needs a label of at most 80 characters.`);
          }
          if (
            typeof command.description !== "string" ||
            !command.description.trim() ||
            command.description.length > 500
          ) {
            errors.push(`Command ${index} needs a description of at most 500 characters.`);
          }
          if (command.aiCallable !== undefined && typeof command.aiCallable !== "boolean") {
            errors.push(`Command ${index} aiCallable must be a boolean.`);
          }
          if (command.aiCallable === true) {
            if (!Array.isArray(input.capabilities) || !input.capabilities.includes("ai-tools")) {
              errors.push(`Command ${index} requires the ai-tools capability.`);
            }
            if (
              !record(engines) ||
              typeof engines.api !== "string" ||
              !apiRangeIsSafe(engines.api, "1.3.0")
            ) {
              errors.push(`Command ${index} requires engines.api to start at 1.3.0 or later.`);
            }
          }
        }
      }
      if (input.logic === undefined) errors.push("contributes.commands requires logic.entry.");
    } else if (input.logic !== undefined) {
      errors.push("logic.entry requires contributes.commands.");
    }
    if (
      Array.isArray(input.capabilities) &&
      input.capabilities.includes("ai-tools") &&
      (!Array.isArray(contributes.commands) ||
        !contributes.commands.some(
          (command: unknown) => record(command) && command.aiCallable === true,
        ))
    ) {
      errors.push("ai-tools capability requires at least one AI-callable command.");
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const manifest = input as TabsExtensionManifest;
  return { ok: true, manifest, id: `${manifest.publisher}.${manifest.name}` };
}

export function isExtensionEnabledForProject(
  assignment: TabsExtensionAssignment,
  projectId: string,
): boolean {
  if (assignment.disabledProjectIds.includes(projectId)) return false;
  return assignment.enabledGlobally || assignment.enabledProjectIds.includes(projectId);
}

export function extensionProfileForProject(
  assignment: TabsExtensionAssignment,
  projectId: string,
): string {
  return assignment.profileIdByProjectId[projectId] ?? assignment.defaultProfileId;
}
