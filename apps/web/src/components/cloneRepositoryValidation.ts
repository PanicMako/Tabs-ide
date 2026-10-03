const REMOTE_SCHEMES = new Set(["http:", "https:", "ssh:", "git:", "file:"]);
const SCP_STYLE_REMOTE = /^(?:[^@\s/:]+@)?[^\s/:]+:.+$/;

export function validateCloneSource(input: string): string | null {
  const value = input.trim();
  if (!value) return "Enter a repository URL or path.";
  if (value.length > 8_192) return "The repository address is too long.";
  if (value.startsWith("-")) return "The repository address cannot start with an option.";
  if (/\0|[\r\n]/.test(value)) return "The repository address contains invalid characters.";
  // Check filesystem syntax before URL parsing so Windows drive letters are
  // not mistaken for unsupported URL schemes such as `c:`.
  if (/^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|~[\\/])/.test(value)) return null;
  const scheme = /^([A-Za-z][A-Za-z\d+.-]*):/.exec(value)?.[1]?.toLowerCase();
  if (scheme && !REMOTE_SCHEMES.has(`${scheme}:`)) {
    return `The ${scheme}: protocol is not supported for cloning.`;
  }
  if (SCP_STYLE_REMOTE.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!REMOTE_SCHEMES.has(parsed.protocol)) {
      return `The ${parsed.protocol} protocol is not supported for cloning.`;
    }
    return parsed.protocol === "file:" || parsed.hostname
      ? null
      : "Enter a complete repository URL.";
  } catch {
    return "Enter a complete Git URL, SSH address, or filesystem path.";
  }
}
