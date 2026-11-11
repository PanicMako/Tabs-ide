import {
  TABS_EXTENSION_QUICK_ACTION_ICONS,
  type TabsExtensionAssignment,
  type TabsExtensionManifest,
} from "@tabs/contracts";
import { TABS_EXTENSION_API_VERSION } from "@tabs/extension-api";
import { compareSemverVersions, parseSemver, satisfiesSemverRange } from "./semver.ts";

const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;
const PACKAGE_VERSION = /^[0-9A-Za-z.+-]{1,128}$/;
const MAX_TOOLS = 12;
const MAX_COMMANDS = 8;
const MAX_QUICK_ACTIONS = 6;
const MAX_THEMES = 8;
const MAX_PALETTE_COMMANDS = 12;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const KEYWORD = /^[a-z0-9][a-z0-9-]{0,31}$/;
const STORAGE_KEY = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/;

export function isSafeExtensionPackageVersion(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_VERSION.test(value) && parseSemver(value) !== null;
}

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

export function extensionApiRangeCompatible(range: string): boolean {
  return satisfiesSemverRange(TABS_EXTENSION_API_VERSION, range);
}

function supportedTabsRangeSyntax(range: string): boolean {
  return (
    range.length > 0 &&
    range.length <= 256 &&
    range.split("||").every((group) => {
      const comparators = group.trim().split(/\s+/);
      return (
        comparators.length > 0 &&
        comparators.every((comparator) =>
          /^(?:\^|>=|>|<=|<|=)?v?\d+(?:\.\d+){0,2}$/.test(comparator),
        )
      );
    })
  );
}

/** Null versions validate package structure for inventory/review without authorizing activation. */
export function validateTabsExtensionManifest(
  input: unknown,
  tabsVersion: string | null,
  apiVersion: string | null = TABS_EXTENSION_API_VERSION,
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
    "listing",
    "engines",
    "networkHosts",
    "storage",
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
  if (!isSafeExtensionPackageVersion(input.version)) {
    errors.push("version must be URL-safe semantic versioning, at most 128 characters.");
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
    !supportedTabsRangeSyntax(engines.tabs)
  ) {
    errors.push("engines.tabs must use a supported, bounded Tabs version range.");
  } else if (tabsVersion !== null && !satisfiesSemverRange(tabsVersion, engines.tabs)) {
    errors.push(`engines.tabs must include this Tabs version (${tabsVersion}).`);
  }
  if (record(engines) && Object.keys(engines).some((key) => key !== "tabs" && key !== "api")) {
    errors.push("engines has unsupported fields.");
  }
  if (
    record(engines) &&
    engines.api !== undefined &&
    (typeof engines.api !== "string" ||
      !supportedTabsRangeSyntax(engines.api) ||
      (apiVersion !== null && !satisfiesSemverRange(apiVersion, engines.api)))
  ) {
    errors.push(
      `engines.api must include the current extension API (${apiVersion ?? TABS_EXTENSION_API_VERSION}).`,
    );
  }
  const contributes = input.contributes;
  if (input.listing !== undefined) {
    const listing = input.listing;
    if (
      !record(listing) ||
      Object.keys(listing).some(
        (key) =>
          ![
            "readme",
            "icon",
            "screenshots",
            "license",
            "categories",
            "keywords",
            "externalServices",
          ].includes(key),
      )
    ) {
      errors.push("listing must contain only supported presentation fields.");
    } else {
      if (listing.screenshots !== undefined) {
        const screenshots = listing.screenshots;
        if (
          !Array.isArray(screenshots) ||
          screenshots.length > 6 ||
          screenshots.some(
            (screenshot) =>
              !record(screenshot) ||
              Object.keys(screenshot).some((key) => !["path", "alt"].includes(key)) ||
              !safePackagePath(screenshot.path) ||
              !/\.(png|jpg|jpeg|webp)$/i.test(screenshot.path) ||
              typeof screenshot.alt !== "string" ||
              !screenshot.alt.trim() ||
              screenshot.alt.length > 300,
          ) ||
          (Array.isArray(screenshots) &&
            new Set(
              screenshots.map((screenshot) => (record(screenshot) ? screenshot.path : undefined)),
            ).size !== screenshots.length)
        )
          errors.push(
            "listing.screenshots must contain at most six unique packaged raster paths with nonempty descriptions of at most 300 characters.",
          );
        if (
          !record(engines) ||
          typeof engines.api !== "string" ||
          !apiRangeIsSafe(engines.api, "1.7.0")
        )
          errors.push("listing.screenshots requires engines.api to start at 1.7.0 or later.");
      }
      for (const key of ["readme", "icon"] as const) {
        if (listing[key] !== undefined && !safePackagePath(listing[key]))
          errors.push(`listing.${key} must be a relative packaged path.`);
      }
      if (
        listing.readme !== undefined &&
        (typeof listing.readme !== "string" || !listing.readme.endsWith(".md"))
      )
        errors.push("listing.readme must be a Markdown file.");
      if (
        listing.icon !== undefined &&
        (typeof listing.icon !== "string" || !/\.(png|jpg|jpeg|webp)$/i.test(listing.icon))
      )
        errors.push("listing.icon must be a PNG, JPEG, or WebP image.");
      if (
        listing.license !== undefined &&
        (typeof listing.license !== "string" || !/^[A-Za-z0-9.-]{1,100}$/.test(listing.license))
      )
        errors.push("listing.license must be a bounded license identifier.");
      for (const key of ["categories", "keywords"] as const) {
        const values = listing[key];
        if (
          values !== undefined &&
          (!Array.isArray(values) ||
            values.length > 12 ||
            new Set(values).size !== values.length ||
            values.some(
              (value) => typeof value !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(value),
            ))
        )
          errors.push(`listing.${key} must contain at most 12 unique lowercase tags.`);
      }
      if (
        listing.externalServices !== undefined &&
        (typeof listing.externalServices !== "string" ||
          !listing.externalServices.trim() ||
          listing.externalServices.length > 2000)
      )
        errors.push("listing.externalServices must be nonempty text of at most 2000 characters.");
    }
    if (
      !record(engines) ||
      typeof engines.api !== "string" ||
      !apiRangeIsSafe(engines.api, "1.6.0")
    )
      errors.push("listing metadata requires engines.api to start at 1.6.0 or later.");
  }
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
  if (input.storage !== undefined) {
    const storage = input.storage;
    if (
      !record(storage) ||
      Object.keys(storage).some((key) => !["version", "migrations"].includes(key))
    ) {
      errors.push("storage supports only version and migrations.");
    } else {
      const version = storage.version;
      if (!Number.isInteger(version) || (version as number) < 1 || (version as number) > 16) {
        errors.push("storage.version must be an integer from 1 to 16.");
      }
      const migrations = storage.migrations ?? [];
      if (!Array.isArray(migrations) || migrations.length !== (version as number) - 1) {
        errors.push("storage.migrations must contain every step from version 1.");
      } else {
        for (const [index, migration] of migrations.entries()) {
          if (
            !record(migration) ||
            Object.keys(migration).some((key) => !["from", "to", "renames"].includes(key)) ||
            migration.from !== index + 1 ||
            migration.to !== index + 2 ||
            !Array.isArray(migration.renames) ||
            migration.renames.length < 1 ||
            migration.renames.length > 32
          ) {
            errors.push(
              `Storage migration ${index} must rename keys from version ${index + 1} to ${index + 2}.`,
            );
            continue;
          }
          const sources = new Set<string>();
          const destinations = new Set<string>();
          for (const rename of migration.renames) {
            if (
              !record(rename) ||
              Object.keys(rename).some((key) => !["from", "to"].includes(key)) ||
              typeof rename.from !== "string" ||
              !STORAGE_KEY.test(rename.from) ||
              typeof rename.to !== "string" ||
              !STORAGE_KEY.test(rename.to) ||
              rename.from === rename.to ||
              sources.has(rename.from) ||
              destinations.has(rename.to)
            ) {
              errors.push(`Storage migration ${index} has an invalid or duplicate key rename.`);
              continue;
            }
            sources.add(rename.from);
            destinations.add(rename.to);
          }
          if ([...destinations].some((key) => sources.has(key))) {
            errors.push(`Storage migration ${index} cannot chain renames within one step.`);
          }
        }
      }
    }
    if (!Array.isArray(input.capabilities) || !input.capabilities.includes("profile-storage")) {
      errors.push("storage migrations require the profile-storage capability.");
    }
    if (
      !record(engines) ||
      typeof engines.api !== "string" ||
      !apiRangeIsSafe(engines.api, "1.4.0")
    ) {
      errors.push("storage migrations require engines.api to start at 1.4.0 or later.");
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
      input.capabilities.length > 6 ||
      new Set(input.capabilities).size !== input.capabilities.length ||
      input.capabilities.some(
        (capability) =>
          capability !== "profile-storage" &&
          capability !== "workspace-read" &&
          capability !== "git-status" &&
          capability !== "network" &&
          capability !== "credentials" &&
          capability !== "ai-tools",
      ))
  ) {
    errors.push(
      "capabilities supports only profile-storage, workspace-read, git-status, network, credentials, and ai-tools without duplicates.",
    );
  }
  if (
    Array.isArray(input.capabilities) &&
    input.capabilities.includes("git-status") &&
    (!record(engines) || typeof engines.api !== "string" || !apiRangeIsSafe(engines.api, "1.5.0"))
  ) {
    errors.push("git-status requires engines.api to start at 1.5.0 or later.");
  }
  if (!record(contributes) || !Array.isArray(contributes.tools)) {
    errors.push("contributes.tools must be an array.");
  } else {
    if (
      Object.keys(contributes).some(
        (key) => !["tools", "commands", "quickActions", "themes", "paletteCommands"].includes(key),
      )
    ) {
      errors.push("contributes has unsupported fields.");
    }
    // A package that only restyles Tabs needs no tool of its own.
    const minimumTools = contributes.themes !== undefined ? 0 : 1;
    if (contributes.tools.length < minimumTools || contributes.tools.length > MAX_TOOLS) {
      errors.push(`contributes.tools must contain ${minimumTools} to ${MAX_TOOLS} tools.`);
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
    if (contributes.quickActions !== undefined) {
      validateQuickActions(contributes.quickActions, seen, engines, errors);
    }
    if (contributes.themes !== undefined) {
      validateThemes(contributes.themes, engines, errors);
    }
    if (contributes.paletteCommands !== undefined) {
      validatePaletteCommands(contributes.paletteCommands, seen, engines, errors);
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

function requireApi(engines: unknown, minimum: string, field: string, errors: string[]): void {
  if (
    !record(engines) ||
    typeof engines.api !== "string" ||
    !apiRangeIsSafe(engines.api, minimum)
  ) {
    errors.push(`${field} requires engines.api to start at ${minimum} or later.`);
  }
}

function validateThemes(themes: unknown, engines: unknown, errors: string[]): void {
  if (!Array.isArray(themes) || themes.length < 1 || themes.length > MAX_THEMES) {
    errors.push(`contributes.themes must contain 1 to ${MAX_THEMES} themes.`);
    return;
  }
  requireApi(engines, "1.9.0", "contributes.themes", errors);
  const ids = new Set<string>();
  for (const [index, theme] of themes.entries()) {
    if (!record(theme)) {
      errors.push(`Theme ${index} must be an object.`);
      continue;
    }
    if (Object.keys(theme).some((key) => !["id", "label", "appearance", "colors"].includes(key))) {
      errors.push(`Theme ${index} has unsupported fields.`);
    }
    if (typeof theme.id !== "string" || !SEGMENT.test(theme.id) || ids.has(theme.id)) {
      errors.push(`Theme ${index} needs a unique lowercase id.`);
    } else ids.add(theme.id);
    if (typeof theme.label !== "string" || !theme.label.trim() || theme.label.length > 60) {
      errors.push(`Theme ${index} needs a label of at most 60 characters.`);
    }
    if (theme.appearance !== "dark" && theme.appearance !== "light") {
      errors.push(`Theme ${index} appearance must be "dark" or "light".`);
    }
    const colors = theme.colors;
    const keys = ["background", "foreground", "card", "border", "primary"];
    // Plain hex only: no CSS functions, variables or url(), so a theme can
    // only recolor Tabs, never inject styles or load remote resources.
    if (
      !record(colors) ||
      Object.keys(colors).length !== keys.length ||
      !keys.every((key) => typeof colors[key] === "string" && HEX_COLOR.test(colors[key]))
    ) {
      errors.push(
        `Theme ${index} colors must be exactly ${keys.join(", ")} as six-digit hex values.`,
      );
    }
  }
}

function validatePaletteCommands(
  commands: unknown,
  toolIds: ReadonlySet<string>,
  engines: unknown,
  errors: string[],
): void {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > MAX_PALETTE_COMMANDS) {
    errors.push(`contributes.paletteCommands must contain 1 to ${MAX_PALETTE_COMMANDS} commands.`);
    return;
  }
  requireApi(engines, "1.9.0", "contributes.paletteCommands", errors);
  const ids = new Set<string>();
  for (const [index, command] of commands.entries()) {
    if (!record(command)) {
      errors.push(`Palette command ${index} must be an object.`);
      continue;
    }
    if (
      Object.keys(command).some(
        (key) => !["id", "title", "description", "keywords", "tool"].includes(key),
      )
    ) {
      errors.push(`Palette command ${index} has unsupported fields.`);
    }
    if (typeof command.id !== "string" || !SEGMENT.test(command.id) || ids.has(command.id)) {
      errors.push(`Palette command ${index} needs a unique lowercase id.`);
    } else ids.add(command.id);
    if (typeof command.title !== "string" || !command.title.trim() || command.title.length > 80) {
      errors.push(`Palette command ${index} needs a title of at most 80 characters.`);
    }
    if (
      command.description !== undefined &&
      (typeof command.description !== "string" ||
        !command.description.trim() ||
        command.description.length > 160)
    ) {
      errors.push(`Palette command ${index} description must be at most 160 characters.`);
    }
    if (
      command.keywords !== undefined &&
      (!Array.isArray(command.keywords) ||
        command.keywords.length > 8 ||
        !command.keywords.every((word: unknown) => typeof word === "string" && KEYWORD.test(word)))
    ) {
      errors.push(`Palette command ${index} keywords must be up to 8 short lowercase words.`);
    }
    if (typeof command.tool !== "string" || !toolIds.has(command.tool)) {
      errors.push(`Palette command ${index} must open a tool from contributes.tools.`);
    }
  }
}

function validateQuickActions(
  quickActions: unknown,
  toolIds: ReadonlySet<string>,
  engines: unknown,
  errors: string[],
): void {
  if (
    !Array.isArray(quickActions) ||
    quickActions.length < 1 ||
    quickActions.length > MAX_QUICK_ACTIONS
  ) {
    errors.push(`contributes.quickActions must contain 1 to ${MAX_QUICK_ACTIONS} actions.`);
    return;
  }
  if (
    !record(engines) ||
    typeof engines.api !== "string" ||
    !apiRangeIsSafe(engines.api, "1.8.0")
  ) {
    errors.push("contributes.quickActions requires engines.api to start at 1.8.0 or later.");
  }
  const ids = new Set<string>();
  for (const [index, action] of quickActions.entries()) {
    if (!record(action)) {
      errors.push(`Quick action ${index} must be an object.`);
      continue;
    }
    if (
      Object.keys(action).some((key) => !["id", "label", "detail", "icon", "tool"].includes(key))
    ) {
      errors.push(`Quick action ${index} has unsupported fields.`);
    }
    if (typeof action.id !== "string" || !SEGMENT.test(action.id) || ids.has(action.id)) {
      errors.push(`Quick action ${index} needs a unique lowercase id.`);
    } else ids.add(action.id);
    // Short: launcher labels sit on a ring and must not wrap.
    if (typeof action.label !== "string" || !action.label.trim() || action.label.length > 40) {
      errors.push(`Quick action ${index} needs a label of at most 40 characters.`);
    }
    if (
      action.detail !== undefined &&
      (typeof action.detail !== "string" || !action.detail.trim() || action.detail.length > 120)
    ) {
      errors.push(`Quick action ${index} detail must be nonempty and at most 120 characters.`);
    }
    if (
      action.icon !== undefined &&
      !(TABS_EXTENSION_QUICK_ACTION_ICONS as readonly unknown[]).includes(action.icon)
    ) {
      errors.push(`Quick action ${index} icon must be one of the launcher icons.`);
    }
    if (typeof action.tool !== "string" || !toolIds.has(action.tool)) {
      errors.push(`Quick action ${index} must open a tool from contributes.tools.`);
    }
  }
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
