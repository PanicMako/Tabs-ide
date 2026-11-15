import type { SecretProviderId } from "@tabs/contracts";
import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";
import { encodeStoredReference } from "@tabs/shared/secretProviders/storedReference";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/**
 * Bitbucket credentials for the connected server, used before the T3CODE_BITBUCKET_* variables.
 * The server keeps tokens in its secret store and only tells clients that one is set. A token can
 * be an `op://` reference, which the server reads from the secret provider on each request.
 */
export function BitbucketTokenSettings({ readOnly = false }: { readonly readOnly?: boolean } = {}) {
  const bitbucket = useSettings((settings) => settings.bitbucket);
  const secretProviders = useSettings((settings) => settings.secretProviders) ?? {};
  const { updateSettings } = useUpdateSettings();
  const [email, setEmail] = useState("");
  const [accessDraft, setAccessDraft] = useState("");
  const [apiDraft, setApiDraft] = useState("");

  const asToken = (typed: string) => {
    const owner = Object.entries(secretProviders).find(
      ([, config]) =>
        builtInSecretProviderDefinitions.find(config.kind)?.isReference(typed) === true,
    );
    return owner
      ? encodeStoredReference({ provider: owner[0] as SecretProviderId, reference: typed })
      : typed;
  };
  const hasAccess = (bitbucket?.accessToken ?? "").length > 0;
  const hasApi = (bitbucket?.apiToken ?? "").length > 0;
  const savedEmail = bitbucket?.email ?? "";

  return (
    <SettingsSection title="Bitbucket">
      <SettingsRow
        title="Access token"
        description={
          hasAccess
            ? "Saved on the server. It is never shown again. It wins over an API token."
            : "Optional. A repository or workspace access token, or an op:// reference."
        }
        control={
          readOnly ? null : hasAccess ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateSettings({ bitbucket: { accessToken: "" } })}
            >
              Remove token
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const typed = accessDraft.trim();
                if (typed) updateSettings({ bitbucket: { accessToken: asToken(typed) } });
                setAccessDraft("");
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                aria-label="Bitbucket access token"
                placeholder="Paste token or op:// reference"
                value={accessDraft}
                onChange={(event) => setAccessDraft(event.target.value)}
                className="w-52"
              />
              <Button size="sm" type="submit" disabled={accessDraft.trim().length === 0}>
                Save
              </Button>
            </form>
          )
        }
      />
      <SettingsRow
        title="API token"
        description={
          hasApi
            ? `Saved on the server for ${savedEmail || "your Atlassian email"}.`
            : "Optional. Your Atlassian email and an API token, or an op:// reference."
        }
        control={
          readOnly ? null : hasApi ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateSettings({ bitbucket: { apiToken: "" } })}
            >
              Remove token
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const typed = apiDraft.trim();
                if (typed)
                  updateSettings({
                    bitbucket: {
                      apiToken: asToken(typed),
                      ...(email.trim() ? { email: email.trim() } : {}),
                    },
                  });
                setApiDraft("");
              }}
            >
              <Input
                type="email"
                autoComplete="off"
                aria-label="Atlassian email"
                placeholder={savedEmail || "Atlassian email"}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-44"
              />
              <Input
                type="password"
                autoComplete="off"
                aria-label="Bitbucket API token"
                placeholder="Token or op:// reference"
                value={apiDraft}
                onChange={(event) => setApiDraft(event.target.value)}
                className="w-48"
              />
              <Button size="sm" type="submit" disabled={apiDraft.trim().length === 0}>
                Save
              </Button>
            </form>
          )
        }
      />
    </SettingsSection>
  );
}
