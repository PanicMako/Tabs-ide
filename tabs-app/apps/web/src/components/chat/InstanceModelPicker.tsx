import type {
  ModelSelection,
  ModelSlug,
  ProviderInstanceId,
  ProviderOptionSelection,
  ServerProvider,
} from "@tabs/contracts";
import { useMemo } from "react";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import type { ProviderPickerKind } from "../../session-logic";
import { FusedModelPicker } from "./FusedModelPicker";
import { CompactModelPicker } from "./CompactModelPicker";

/** Width below which the Fused picker's popup (about 40rem) no longer fits comfortably. */
const FULL_PICKER_MIN_WIDTH_PX = 900;

/** The provider account a picker `kind` (an instance id or a driver) points at. */
export function instanceForKind(
  providers: ReadonlyArray<ServerProvider>,
  kind: string,
): ServerProvider | undefined {
  return (
    providers.find((provider) => provider.instanceId === kind) ??
    providers.find((provider) => provider.driver === kind)
  );
}

/** A model choice on one provider account, carrying its thinking-level options when it has any. */
export function modelSelectionFrom(
  instanceId: ProviderInstanceId,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): ModelSelection {
  return {
    instanceId,
    model,
    ...(options && options.length > 0
      ? { options: options.map(({ id, value }) => ({ id, value })) }
      : {}),
  };
}

const NOOP = () => {};

/**
 * Picks a provider, a model and its thinking level for a value that lives outside a chat.
 * With room it is the full Fused picker, where the thinking level is a slider of dots. When the
 * window is narrow it becomes two slim menus: model, then thinking level.
 */
export function InstanceModelPicker(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly value: ModelSelection | null;
  readonly ariaLabel: string;
  readonly onChange: (value: ModelSelection) => void;
  readonly triggerClassName?: string;
  /** Which edge of the trigger the full picker's popup lines up with. */
  readonly align?: "start" | "center" | "end";
  /** Overrides the window-width rule: always the slim menus. */
  readonly forceCompact?: boolean;
}) {
  const wide = useMediaQuery({ min: FULL_PICKER_MIN_WIDTH_PX });
  const compact = props.forceCompact === true || !wide;
  const instance =
    props.providers.find((provider) => provider.instanceId === props.value?.instanceId) ??
    props.providers[0];
  const modelOptionsByProvider = useMemo(() => {
    const map: Partial<Record<ProviderPickerKind, ReadonlyArray<{ slug: string; name: string }>>> =
      {};
    for (const provider of props.providers) {
      map[provider.driver as ProviderPickerKind] = provider.models.map(({ slug, name }) => ({
        slug,
        name,
      }));
    }
    return map;
  }, [props.providers]);
  if (!instance) return null;

  const kind = instance.driver as ProviderPickerKind;
  const model = (props.value?.model ?? instance.models[0]?.slug ?? "") as ModelSlug;
  const options = props.value?.options as ReadonlyArray<ProviderOptionSelection> | undefined;
  const choose = (nextKind: string, nextModel: string, nextOptions?: typeof options) => {
    const next = instanceForKind(props.providers, nextKind);
    if (next) props.onChange(modelSelectionFrom(next.instanceId, nextModel, nextOptions));
  };

  if (compact) {
    return (
      <CompactModelPicker
        triggerVariant="outline"
        provider={kind}
        model={model}
        lockedProvider={null}
        providers={props.providers}
        modelOptionsByProvider={modelOptionsByProvider}
        modelOptions={options}
        ariaLabel={props.ariaLabel}
        {...(props.triggerClassName ? { triggerClassName: props.triggerClassName } : {})}
        onProviderModelChange={(nextKind, nextModel) => choose(nextKind, nextModel)}
        onModelOptionsChange={(next) => choose(instance.instanceId, model, next)}
      />
    );
  }
  return (
    <FusedModelPicker
      provider={kind}
      model={model}
      lockedProvider={null}
      providers={props.providers}
      prompt=""
      onPromptChange={NOOP}
      modelOptions={options}
      ariaLabel={props.ariaLabel}
      triggerClassName={props.triggerClassName ?? "max-w-full"}
      align={props.align ?? "start"}
      onProviderModelChange={(nextKind, nextModel, nextOptions) =>
        choose(nextKind, nextModel, nextOptions)
      }
      onModelOptionsChange={(next) => choose(instance.instanceId, model, next)}
    />
  );
}
