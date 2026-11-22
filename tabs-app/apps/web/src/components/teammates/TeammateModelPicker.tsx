import type { ModelSelection, ServerProvider } from "@tabs/contracts";
import { createModelSelection } from "@tabs/shared/model";
import { useMemo } from "react";
import { useSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { useServerConfig } from "~/state/settings";
import { SettingsProviderModelPicker } from "../chat/SettingsProviderModelPicker";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/**
 * The model picker used for a teammate. `value` null means "your default model", which is what
 * the picker shows until a model is chosen.
 */
export function TeammateModelPicker({
  value,
  onChange,
}: {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
}) {
  const settings = useSettings();
  const serverProviders = useServerConfig()?.providers ?? NO_PROVIDERS;
  const selection = value ?? settings.textGenerationModelSelection;
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const optionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        serverProviders,
        selection?.instanceId ?? null,
        selection?.model ?? null,
      ),
    [settings, serverProviders, selection?.instanceId, selection?.model],
  );
  if (!selection) return <span className="tm-supporting">No models available yet.</span>;
  return (
    <SettingsProviderModelPicker
      activeInstanceId={selection.instanceId}
      model={selection.model}
      instanceEntries={entries}
      modelOptionsByInstance={optionsByInstance}
      triggerVariant="outline"
      triggerClassName="min-w-0 max-w-56 shrink-0"
      onInstanceModelChange={(instanceId, model) =>
        onChange(createModelSelection(instanceId, model))
      }
    />
  );
}
