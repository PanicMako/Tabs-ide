import type {
  ProviderInstanceEnvironmentVariable,
  SecretProviderId,
  SecretReference,
} from "@tabs/contracts";

/** One editable row; `secret` is set when the value is read from a secret provider. */
export interface EnvironmentRow {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly secret: string;
  readonly sensitive: boolean;
}

export const ENVIRONMENT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

let nextId = 0;
export const newEnvironmentRow = (): EnvironmentRow => ({
  id: `env-${nextId++}`,
  name: "",
  value: "",
  secret: "",
  sensitive: true,
});

export function rowsFromEnvironment(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): ReadonlyArray<EnvironmentRow> {
  return environment.map((variable) => ({
    id: `env-${nextId++}`,
    name: variable.name,
    // A stored sensitive value is redacted by the server, so it is never shown for editing.
    value:
      typeof variable.value === "string" && variable.valueRedacted !== true ? variable.value : "",
    secret: typeof variable.value === "string" ? "" : variable.value.reference,
    sensitive: variable.sensitive,
  }));
}

export function isDuplicateName(rows: ReadonlyArray<EnvironmentRow>, row: EnvironmentRow) {
  const name = row.name.trim();
  return name.length > 0 && rows.some((other) => other.id !== row.id && other.name.trim() === name);
}

export function rowError(
  rows: ReadonlyArray<EnvironmentRow>,
  row: EnvironmentRow,
  isReference: (value: string) => boolean,
  hasSecretProvider: boolean,
): string | null {
  const name = row.name.trim();
  if (name.length === 0) return row.value === "" && row.secret === "" ? null : "Name the variable.";
  if (!ENVIRONMENT_NAME_PATTERN.test(name)) return "Use letters, digits and underscores.";
  if (isDuplicateName(rows, row)) return "That name is already used.";
  if (row.secret.trim().length > 0) {
    if (!hasSecretProvider) return "Add a secret provider first.";
    if (!isReference(row.secret.trim())) return "That is not a valid secret reference.";
  }
  return null;
}

/**
 * The variables to store. A row with a secret reference keeps only the reference; empty rows are
 * dropped. `firstProvider` owns references, as it is the only provider kind Tabs ships.
 */
export function environmentFromRows(
  rows: ReadonlyArray<EnvironmentRow>,
  firstProvider: SecretProviderId | undefined,
  previous: ReadonlyArray<ProviderInstanceEnvironmentVariable> = [],
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const out: Array<ProviderInstanceEnvironmentVariable> = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) continue;
    const secret = row.secret.trim();
    if (secret.length > 0 && firstProvider !== undefined) {
      const reference: SecretReference = { provider: firstProvider, reference: secret };
      out.push({ name, value: reference, sensitive: true });
      continue;
    }
    const before = previous.find((variable) => variable.name === name);
    // An untouched redacted value stays as the server holds it.
    if (row.value === "" && before?.valueRedacted === true && typeof before.value === "string") {
      out.push(before);
      continue;
    }
    out.push({ name, value: row.value, sensitive: row.sensitive });
  }
  return out;
}
