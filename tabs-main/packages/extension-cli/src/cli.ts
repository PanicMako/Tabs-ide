#!/usr/bin/env node
import * as FS from "node:fs";
import { registryError } from "./registryError.ts";
import * as Path from "node:path";
import { spawn } from "node:child_process";
import { packTabsext, inspectTabsext, validateTabsextDirectory } from "@tabs/extension-package";
import { initProject } from "./starter.ts";
import { cliHelp } from "./help.ts";
import { humanOutput, targetVersion } from "./workflow.ts";
import { watchSubmission } from "./watch.ts";

const raw = process.argv.slice(2);
const flags = new Map<string, string>();
const args: string[] = [];
try {
  if (raw.includes("--help") || raw.includes("-h") || raw[0] === "help") {
    const command = raw[0] === "help" ? raw[1] : raw.find((value) => !value.startsWith("-"));
    process.stdout.write(cliHelp(command));
    process.exit(0);
  }
  for (let index = 0; index < raw.length; index++) {
    const value = raw[index]!;
    if (value === "--json" || value === "--watch") {
      if (flags.has(value)) throw new Error(`Duplicate option: ${value}`);
      flags.set(value, "true");
      continue;
    }
    if (value.startsWith("--")) {
      if (
        ![
          "--sdk",
          "--publisher",
          "--name",
          "--template",
          "--tabs-version",
          "--registry",
          "--directory",
          "--watch-timeout",
        ].includes(value) ||
        flags.has(value) ||
        !raw[index + 1] ||
        raw[index + 1]!.startsWith("--")
      )
        throw new Error(`Invalid option: ${value}`);
      flags.set(value, raw[++index]!);
    } else args.push(value);
  }
  const command = args[0];
  if ((flags.has("--watch") || flags.has("--watch-timeout")) && command !== "status")
    throw new Error("--watch and --watch-timeout are only supported by status.");
  if (flags.has("--watch-timeout") && !flags.has("--watch"))
    throw new Error("--watch-timeout requires --watch.");
  const watchSeconds = flags.get("--watch-timeout") ?? "900";
  if (!/^[1-9][0-9]{0,3}$/.test(watchSeconds) || Number(watchSeconds) > 3600)
    throw new Error("--watch-timeout must be 1–3600 seconds.");
  const version = () => targetVersion(flags.get("--tabs-version"));
  const staged = flags.get("--directory") ?? ".tabs-extension";
  const print = (result: unknown) =>
    process.stdout.write(
      flags.has("--json")
        ? `${JSON.stringify(result, null, flags.has("--watch") ? undefined : 2)}\n`
        : humanOutput(command ?? "result", result),
    );
  const origin = () => {
    const url = new URL(flags.get("--registry") ?? process.env.TABS_EXCHANGE_ORIGIN ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Registry must be an HTTPS origin without credentials or a path.");
    return url.origin;
  };
  const request = async (path: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const token = process.env.TABS_EXCHANGE_TOKEN;
    if (token && !/^tex_[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Invalid registry token format.");
    const response = await fetch(`${origin()}${path}`, {
      ...init,
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing registry response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 1024 * 1024) throw new Error("Registry response is too large.");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    let data: any;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      if (!response.ok) throw registryError(response.status, null);
      throw new Error("Invalid registry JSON response.");
    }
    if (!response.ok) throw registryError(response.status, data);
    return data;
  };
  if (command === "init" && args.length === 2) {
    const directory = args[1]!;
    const template = flags.get("--template") ?? "react";
    if (template !== "react" && template !== "html")
      throw new Error("Template must be react or html.");
    if (template === "react" && !flags.has("--sdk"))
      throw new Error(
        "Pass --sdk <local-tarball> from the developer bundle; the SDK is not published to npm.",
      );
    initProject(directory, {
      publisher: flags.get("--publisher") ?? "my-publisher",
      name: flags.get("--name") ?? Path.basename(Path.resolve(directory)),
      template,
      sdk: flags.get("--sdk"),
      tabsVersion: targetVersion(flags.get("--tabs-version"), Path.resolve(directory)),
    });
    print({
      directory,
      next: "npm install, npm run build, then load .tabs-extension in Tabs desktop development mode",
      unpublishedSdk: !flags.has("--sdk"),
    });
  } else if (command === "validate" && args.length === 1)
    print(validateTabsextDirectory(staged, version()));
  else if (command === "pack" && args.length <= 2) {
    const inspected = validateTabsextDirectory(staged, version());
    print(
      await packTabsext({
        directory: staged,
        destination: args[1] ?? `${inspected.id}-${inspected.manifest.version}.tabsext`,
        tabsVersion: version(),
      }),
    );
  } else if (command === "inspect" && args.length === 2)
    print(await inspectTabsext(args[1]!, version()));
  else if (command === "registry" && args.length === 1) print(await request("/v1/registry"));
  else if (command === "search" && args.length <= 2) {
    const query = args[1] ?? "";
    if (query.length > 100) throw new Error("Search query exceeds 100 characters.");
    print(await request(`/v1/extensions?${new URLSearchParams({ q: query, limit: "30" })}`));
  } else if (command === "status" && args.length === 4) {
    if (args.slice(1).some((value) => !/^[a-zA-Z0-9.+-]{1,128}$/.test(value)))
      throw new Error("Invalid extension identity.");
    const path = `/v1/publisher/${args[1]}/${args[2]}/versions/${args[3]}`;
    if (!flags.has("--watch")) print(await request(path));
    else {
      const cancellation = new AbortController();
      const cancel = () => cancellation.abort();
      process.on("SIGINT", cancel);
      process.on("SIGTERM", cancel);
      try {
        await watchSubmission((signal) => request(path, {}, signal), print, cancellation.signal, {
          timeoutMs: Number(watchSeconds) * 1000,
        });
      } catch (error) {
        if (cancellation.signal.aborted) process.exitCode = 130;
        else throw error;
      } finally {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
      }
    }
  } else if (command === "publish" && args.length === 2) {
    if (!process.env.TABS_EXCHANGE_TOKEN)
      throw new Error("Set TABS_EXCHANGE_TOKEN to a scoped publisher token.");
    const inspected = await inspectTabsext(args[1]!, version());
    const bytes = FS.readFileSync(args[1]!);
    // Re-inspection after read avoids sending bytes different from the validated manifest.
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== inspected.digest)
      throw new Error("Package changed during publication.");
    print(
      await request(
        `/v1/publisher/${inspected.manifest.publisher}/${inspected.manifest.name}/versions`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes },
      ),
    );
  } else if (command === "dev" && args.length === 1) {
    if (flags.has("--json")) throw new Error("dev streams build logs and does not support --json.");
    validateTabsextDirectory(staged, version());
    process.stdout.write(
      "Watching packaged builds. Load .tabs-extension and use Tabs' development reload control; no remote HMR.\n",
    );
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
      stdio: "inherit",
      // npm.cmd is not directly executable by Node on Windows. Arguments here
      // are fixed, never extension-supplied shell fragments.
      shell: process.platform === "win32",
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => child.kill(signal));
    child.on("error", () => {
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  } else
    throw new Error(
      "Usage: tabsext init <directory> [--sdk <tarball>] | validate | pack [archive] | inspect <archive> | dev | registry | search [query] | publish <archive> | status <publisher> <name> <version>",
    );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Extension command failed."}\n`);
  process.exitCode = 1;
}
