const commands = {
  init: {
    usage:
      "init <directory> --tabs-version <version> [--sdk <tarball>] [--publisher <namespace>] [--name <name>] [--template react|html]",
    description:
      "Create a React/TypeScript tool (default) or a plain HTML tool. Use the SDK tarball from the developer release bundle.",
  },
  dev: {
    usage: "dev [--directory <staging-directory>] [--tabs-version <version>]",
    description:
      "Watch local builds after the initial build. Load the staging directory in Tabs development mode and use host-owned reload; remote HMR is not supported.",
  },
  validate: {
    usage: "validate [--directory <staging-directory>] [--tabs-version <version>]",
    description: "Validate the packaged staging directory before loading or publishing it.",
  },
  pack: {
    usage: "pack [archive] [--directory <staging-directory>] [--tabs-version <version>]",
    description: "Validate and package only the staging directory as a .tabsext archive.",
  },
  inspect: {
    usage: "inspect <archive> [--tabs-version <version>]",
    description:
      "Inspect an archive's manifest, identity, digest, and compatibility without executing it.",
  },
  registry: {
    usage: "registry [--registry <https-origin>]",
    description: "Read registry capabilities. This does not save a registry connection.",
  },
  search: {
    usage: "search [query] [--registry <https-origin>]",
    description: "Search published extensions in the selected registry.",
  },
  publish: {
    usage: "publish <archive> [--registry <https-origin>] [--tabs-version <version>]",
    description:
      "Submit a validated archive using TABS_EXCHANGE_TOKEN. Submission requires namespace membership and does not mean approval or signed publication.",
  },
  status: {
    usage:
      "status <publisher> <name> <version> [--registry <https-origin>] [--watch] [--watch-timeout <seconds>]",
    description:
      "Read a submission's review and publication status using your scoped publisher token.",
  },
} as const;

export function cliHelp(command?: string): string {
  if (command) {
    if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command: ${command}`);
    const entry = commands[command as keyof typeof commands];
    return `Usage: tabsext ${entry.usage}\n\n${entry.description}\n\n${defaults()}`;
  }
  return [
    "Tabs extension CLI (experimental; npm publication is not enabled)",
    "",
    "Usage: tabsext <command> [options]",
    "",
    ...Object.entries(commands).map(([name, entry]) => `  ${name.padEnd(10)} ${entry.description}`),
    "",
    "Use tabsext <command> --help for command-specific usage.",
    "",
    defaults(),
  ].join("\n");
}

function defaults(): string {
  return [
    "Staging directory: .tabs-extension (override with --directory).",
    "Compatibility target: --tabs-version, or the project's .tabsext.json created by init. No hidden version default.",
    "Output: readable by default; use --json for automation (except dev).",
    "status --watch checks every 5 seconds, stops after 15 minutes by default, and supports Ctrl+C. --json --watch emits one JSON line per change.",
    "Registry: --registry or TABS_EXCHANGE_ORIGIN; HTTPS origin only.",
    "Authentication: TABS_EXCHANGE_TOKEN; no CLI login or persistent credential store.",
    "Keep tokens out of command arguments and source files.",
    "",
  ].join("\n");
}
