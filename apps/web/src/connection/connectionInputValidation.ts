export function validateRemoteHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the remote environment address.";
  if (/\0|\s/.test(trimmed)) return "The remote address cannot contain whitespace.";
  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    return url.hostname && (url.protocol === "http:" || url.protocol === "https:")
      ? null
      : "Enter a valid HTTP or HTTPS environment address.";
  } catch {
    return "Enter a valid remote environment address.";
  }
}

export function validateSshTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an SSH host or alias.";
  if (trimmed.startsWith("-") || /[\0\r\n\s]/.test(trimmed)) {
    return "Enter a valid SSH host or user@host address.";
  }
  const at = trimmed.lastIndexOf("@");
  const username = at >= 0 ? trimmed.slice(0, at) : null;
  const hostname = at >= 0 ? trimmed.slice(at + 1) : trimmed;
  return !hostname || (username !== null && !username) ? "Enter a complete SSH address." : null;
}

export function validateSshPort(value: string): string | null {
  if (!/^\d+$/.test(value.trim())) return "Enter a numeric SSH port.";
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? null
    : "SSH port must be between 1 and 65535.";
}
