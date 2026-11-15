import { useId } from "react";

import type { OvermindWorkerChoice } from "@tabs/shared/overmind";

export interface OvermindProviderOption {
  readonly instanceId: string;
  readonly displayName?: string | null | undefined;
  readonly models?: ReadonlyArray<{ readonly slug: string; readonly name?: string | null }>;
}

const SELECT =
  "mt-1 w-full rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none";

/**
 * Chooses where an Overmind plan's sub-tasks run. "Same as this thread" keeps the
 * lead's own model; otherwise the lead is told to run every sub-task on the
 * chosen provider and model, so a strong lead can hand the work to a cheap one.
 */
export function OvermindWorkerPicker(props: {
  readonly providers: ReadonlyArray<OvermindProviderOption>;
  readonly value: OvermindWorkerChoice | null;
  readonly onChange: (value: OvermindWorkerChoice | null) => void;
}) {
  const providerId = useId();
  const modelId = useId();
  const provider = props.providers.find((p) => p.instanceId === props.value?.providerInstanceId);
  const models = provider?.models ?? [];

  if (props.providers.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Sub-agents run on</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="sr-only" htmlFor={providerId}>
            Sub-agent provider
          </label>
          <select
            id={providerId}
            aria-label="Sub-agent provider"
            className={SELECT}
            value={props.value?.providerInstanceId ?? ""}
            onChange={(event) => {
              const next = props.providers.find((p) => p.instanceId === event.target.value);
              const first = next?.models?.[0]?.slug;
              props.onChange(
                next && first ? { providerInstanceId: next.instanceId, model: first } : null,
              );
            }}
          >
            <option value="">Same as this thread</option>
            {props.providers.map((p) => (
              <option key={p.instanceId} value={p.instanceId}>
                {p.displayName ?? p.instanceId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="sr-only" htmlFor={modelId}>
            Sub-agent model
          </label>
          <select
            id={modelId}
            aria-label="Sub-agent model"
            className={SELECT}
            disabled={props.value === null}
            value={props.value?.model ?? ""}
            onChange={(event) =>
              props.value &&
              props.onChange({
                providerInstanceId: props.value.providerInstanceId,
                model: event.target.value,
              })
            }
          >
            {props.value === null ? <option value="">—</option> : null}
            {models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name ?? m.slug}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
