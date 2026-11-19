import type { SshDeviceHostConfig } from "@tabs/contracts";

export interface SshHostForm {
  readonly label: string;
  readonly target: string;
  readonly port: string;
  readonly identityFile: string;
}

export const EMPTY_SSH_HOST_FORM: SshHostForm = {
  label: "",
  target: "",
  port: "",
  identityFile: "",
};

export type SshHostFormResult =
  | { readonly ok: true; readonly host: SshDeviceHostConfig }
  | { readonly ok: false; readonly message: string };

/** "My Mac mini" becomes "my-mac-mini", and gets a number if that name is taken. */
export function sshHostIdFor(label: string, existingIds: ReadonlyArray<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "host";
  const safeBase = base === "local" ? "local-host" : base;
  if (!existingIds.includes(safeBase)) return safeBase;
  for (let n = 2; ; n += 1) {
    const candidate = `${safeBase}-${n}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
}

/** Turns what was typed into a host the server will accept, or says plainly what to fix. */
export function buildSshHost(
  form: SshHostForm,
  existingIds: ReadonlyArray<string>,
  editingId?: string,
): SshHostFormResult {
  const label = form.label.trim();
  const target = form.target.trim();
  if (label.length === 0) return { ok: false, message: "Give this machine a name." };
  if (target.length === 0) {
    return { ok: false, message: "Enter how to reach it, like you@machine.local or an SSH alias." };
  }
  if (/\s/.test(target) || target.startsWith("-")) {
    return {
      ok: false,
      message: "The address cannot contain spaces or start with a dash. Use you@machine.local.",
    };
  }
  const portText = form.port.trim();
  let port: number | undefined;
  if (portText.length > 0) {
    port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, message: "The port must be a whole number from 1 to 65535." };
    }
  }
  const identityFile = form.identityFile.trim();
  const otherIds = editingId ? existingIds.filter((id) => id !== editingId) : existingIds;
  return {
    ok: true,
    host: {
      id: editingId ?? sshHostIdFor(label, otherIds),
      label,
      target,
      ...(port === undefined ? {} : { port }),
      ...(identityFile.length === 0 ? {} : { identityFile }),
    },
  };
}

export function sshHostToForm(host: SshDeviceHostConfig): SshHostForm {
  return {
    label: host.label,
    target: host.target,
    port: host.port === undefined ? "" : String(host.port),
    identityFile: host.identityFile ?? "",
  };
}
