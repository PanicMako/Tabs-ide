/**
 * Fields computer use must never type into or read back. The macOS accessibility API marks real
 * password inputs with the AXSecureTextField subrole (browsers do too for <input type=password>);
 * the label check covers custom controls that render secrets as plain text fields.
 */
export const SENSITIVE_SUBROLE = "AXSecureTextField";

export const SENSITIVE_LABEL_SOURCE =
  "pass(?:word|code|phrase)|\\bpin\\b|secret|\\bcvv\\b|\\bcvc\\b|security code|one[- ]time|\\botp\\b|2fa|verification code|card number|api[ -]?key|token";

const SENSITIVE_LABEL = new RegExp(SENSITIVE_LABEL_SOURCE, "i");

export interface FieldIdentity {
  readonly role?: string | undefined;
  readonly subrole?: string | undefined;
  readonly labels?: ReadonlyArray<string | undefined> | undefined;
}

export function isSensitiveField(field: FieldIdentity): boolean {
  if (field.subrole === SENSITIVE_SUBROLE) return true;
  const editable =
    field.role === "AXTextField" || field.role === "AXTextArea" || field.role === "AXComboBox";
  if (!editable) return false;
  return (field.labels ?? []).some((label) => label !== undefined && SENSITIVE_LABEL.test(label));
}

export const SENSITIVE_FIELD_MESSAGE =
  "Refusing to type into a password or other secret field. Ask the user to enter it themselves.";

/**
 * Password managers are off limits to every runtime: their windows are nothing but secrets.
 * Matched case-insensitively against the app name and bundle id.
 */
export const BLOCKED_APP_FRAGMENTS: ReadonlyArray<string> = [
  "1password",
  "bitwarden",
  "dashlane",
  "lastpass",
  "nordpass",
  "proton pass",
  "keepassxc",
  "keychain access",
  "enpass",
];

export function isBlockedApp(name: string, bundleId?: string | null): boolean {
  const haystack = `${name} ${bundleId ?? ""}`.toLowerCase();
  return BLOCKED_APP_FRAGMENTS.some((fragment) => haystack.includes(fragment));
}
