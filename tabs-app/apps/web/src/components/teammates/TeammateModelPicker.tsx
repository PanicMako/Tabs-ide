import type { ModelSelection, ServerProvider } from "@tabs/contracts";
import { useSettings } from "~/hooks/useSettings";
import { useServerConfig } from "~/state/settings";
import { InstanceModelPicker } from "../chat/InstanceModelPicker";
import { selectableSubagentProviders } from "../chat/OvermindWorkerPicker";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/**
 * The model picker used for a teammate, with its thinking level. `value` null means "your default
 * model", which is what the picker shows until a model is chosen. It is the full Fused picker when
 * there is room and two slim menus (model, then thinking level) when there is not.
 */
export function TeammateModelPicker({
  value,
  onChange,
  forceCompact,
}: {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  forceCompact?: boolean;
}) {
  const settings = useSettings();
  const providers = selectableSubagentProviders(useServerConfig()?.providers ?? NO_PROVIDERS);
  const selection = value ?? settings.textGenerationModelSelection ?? null;
  if (providers.length === 0)
    return <span className="tm-supporting">No models available yet.</span>;
  return (
    <InstanceModelPicker
      providers={providers}
      value={selection}
      ariaLabel="Model"
      onChange={onChange}
      {...(forceCompact ? { forceCompact } : {})}
    />
  );
}
