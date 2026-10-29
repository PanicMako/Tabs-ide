/** Restrict managed overrides to existing plugin entries; Tabs owns the ACP/provider wiring. */
export function parseDeepSeekPluginOverrides(
  source: string,
): Array<{ id: string; config?: Record<string, unknown>; disabled?: boolean }> {
  const value: unknown = JSON.parse(source.trim() || "[]");
  if (!Array.isArray(value)) throw new Error("Use a JSON array of plugin overrides.");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Each override needs a plugin entry id.");
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim())
      throw new Error("Each override needs a plugin entry id.");
    if (
      ["acp", "llm-pi-ai", "agent-default-model", "approval", "sandbox", "permission"].includes(
        row.id,
      )
    )
      throw new Error(`Tabs manages the ${row.id} entry. Configure other plugin entries here.`);
    if (Object.keys(row).some((key) => !["id", "config", "disabled"].includes(key)))
      throw new Error("Overrides support id, config, and disabled only.");
    if (row.disabled !== undefined && typeof row.disabled !== "boolean")
      throw new Error("disabled must be true or false.");
    if (
      row.config !== undefined &&
      (!row.config || typeof row.config !== "object" || Array.isArray(row.config))
    )
      throw new Error("config must be a JSON object.");
    return {
      id: row.id,
      ...(row.config !== undefined ? { config: row.config as Record<string, unknown> } : {}),
      ...(typeof row.disabled === "boolean" ? { disabled: row.disabled } : {}),
    };
  });
}

export function deepSeekPluginCommand(
  profile: { home: string; executable: string },
  action: "add" | "remove" | "list",
  spec: string,
  windows = false,
): string {
  const value = spec.trim();
  if (
    action !== "list" &&
    (!value || value.startsWith("-") || /[\r\n]/.test(value) || value.includes("\0"))
  )
    throw new Error("Enter a package name or source, without command flags.");
  const quote = (text: string) =>
    windows ? `'${text.replaceAll("'", "''")}'` : `'${text.replaceAll("'", "'\\''")}'`;
  const command = `${windows ? "& " : ""}${quote(profile.executable)} plugin --profile acp ${action}${action === "list" ? " --depth 0" : ` -- ${quote(value)}`}`;
  return windows
    ? `$env:DSH_HOME=${quote(profile.home)}; ${command}`
    : `DSH_HOME=${quote(profile.home)} ${command}`;
}
