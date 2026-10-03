const result = Bun.spawnSync(["bun", "pm", "ls", "--all"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
});

if (!result.success) {
  process.stderr.write(result.stderr.toString());
  process.exit(result.exitCode);
}

const dependencyTree = result.stdout.toString();
const effectVersions = new Set(
  [...dependencyTree.matchAll(/(?:^|\s)effect@(\S+)/gm)].map((match) => match[1]),
);

if (effectVersions.size !== 1) {
  console.error(
    `Expected exactly one resolved Effect version, found: ${[...effectVersions].join(", ") || "none"}`,
  );
  process.exit(1);
}

console.log(`Resolved Effect version: ${[...effectVersions][0]}`);
