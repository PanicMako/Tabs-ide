import { useState } from "react";
import type { SshDeviceHostConfig } from "@tabs/contracts";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import {
  buildSshHost,
  EMPTY_SSH_HOST_FORM,
  sshHostToForm,
  type SshHostForm,
} from "~/device/sshHostForm";
import { showCustomConfirm } from "~/lib/customConfirm";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow } from "./SettingsLayout";

const FIELDS: ReadonlyArray<{
  key: keyof SshHostForm;
  label: string;
  placeholder: string;
}> = [
  { key: "label", label: "Name", placeholder: "Mac mini" },
  { key: "target", label: "Address", placeholder: "you@mini.local or an SSH alias" },
  { key: "port", label: "Port", placeholder: "22" },
  { key: "identityFile", label: "Key file", placeholder: "~/.ssh/id_ed25519 (optional)" },
];

/** Add, edit and remove the machines devices can come from over SSH. */
export function SshHostsEditor({
  onTest,
  status,
}: {
  onTest?: (host: SshDeviceHostConfig) => void;
  status: Record<string, string | null>;
}) {
  const hosts = useSettings((s) => s.deviceHosts) as ReadonlyArray<SshDeviceHostConfig>;
  const { updateSettings } = useUpdateSettings();
  const [editing, setEditing] = useState<{ id: string | undefined; form: SshHostForm } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    const result = buildSshHost(
      editing.form,
      hosts.map((host) => host.id),
      editing.id,
    );
    if (!result.ok) return setMessage(result.message);
    const next = editing.id
      ? hosts.map((host) => (host.id === editing.id ? result.host : host))
      : [...hosts, result.host];
    setMessage(null);
    if (await updateSettings({ deviceHosts: next })) setEditing(null);
    else setMessage("Could not save. The server refused this host.");
  };

  const remove = async (host: SshDeviceHostConfig) => {
    if (!(await showCustomConfirm(`Remove ${host.label} from your device sources?`))) return;
    await updateSettings({ deviceHosts: hosts.filter((entry) => entry.id !== host.id) });
  };

  return (
    <>
      {hosts.map((host) => (
        <SettingsRow
          key={host.id}
          title={host.label}
          description={`${host.target}${host.port ? `:${host.port}` : ""}. ${status[host.id] ?? "Not tested yet."}`}
          control={
            <div className="flex flex-wrap gap-2">
              {onTest && (
                <Button size="sm" variant="outline" onClick={() => onTest(host)}>
                  Test connection
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessage(null);
                  setEditing({ id: host.id, form: sshHostToForm(host) });
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => void remove(host)}>
                Remove
              </Button>
            </div>
          }
        />
      ))}
      {editing ? (
        <div className="space-y-3 border-t border-border px-4 py-4 sm:px-5">
          {FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span
                className="text-xs text-muted-foreground/80"
                style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
              >
                {field.label}
              </span>
              <Input
                value={editing.form[field.key]}
                placeholder={field.placeholder}
                aria-label={field.label}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, [field.key]: event.target.value },
                  })
                }
              />
            </label>
          ))}
          {message && (
            <p role="alert" className="text-sm text-destructive-foreground">
              {message}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()}>
              {editing.id ? "Save host" : "Add host"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <SettingsRow
          title="Add an SSH machine"
          description="Needs macOS or Linux with Node 22.12 or newer."
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMessage(null);
                setEditing({ id: undefined, form: EMPTY_SSH_HOST_FORM });
              }}
            >
              Add machine
            </Button>
          }
        />
      )}
    </>
  );
}
