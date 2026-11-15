import type { SecretProviderId } from "@tabs/contracts";
import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";
import { encodeStoredReference } from "@tabs/shared/secretProviders/storedReference";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/**
 * A git.cafe token for the connected server, used before `CAFE_TOKEN` and the `cafe` login. The
 * server keeps it in its secret store and only tells clients that one is set.
 */
export function GitCafeTokenSettings({ readOnly = false }: { readonly readOnly?: boolean } = {}) {
  const hasToken = (useSettings((settings) => settings.gitcafe?.token) ?? "").length > 0;
  const secretProviders = useSettings((settings) => settings.secretProviders) ?? {};
  const { updateSettings } = useUpdateSettings();
  const [draft, setDraft] = useState("");

  const save = () => {
    const typed = draft.trim();
    if (typed.length === 0) return;
    // A pasted reference such as op://vault/item/field stays in the secret provider.
    const owner = Object.entries(secretProviders).find(
      ([, config]) =>
        builtInSecretProviderDefinitions.find(config.kind)?.isReference(typed) === true,
    );
    const token = owner
      ? encodeStoredReference({ provider: owner[0] as SecretProviderId, reference: typed })
      : typed;
    updateSettings({ gitcafe: { token } });
    setDraft("");
  };

  return (
    <SettingsSection title="GitCafe">
      <SettingsRow
        title="Access token"
        description={
          hasToken
            ? "Saved on the server. It is never shown again. It is used before CAFE_TOKEN and the cafe login."
            : "Optional. Lets the server reach git.cafe without the cafe CLI signed in."
        }
        control={
          readOnly ? null : hasToken ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateSettings({ gitcafe: { token: "" } })}
            >
              Remove token
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                aria-label="GitCafe access token"
                placeholder="Paste token or op:// reference"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="w-52"
              />
              <Button size="sm" type="submit" disabled={draft.trim().length === 0}>
                Save
              </Button>
            </form>
          )
        }
      />
    </SettingsSection>
  );
}
