import type { ProjectId, Teammate, TeammateLookAroundPreset } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { readModelStateAtom } from "~/state/readModel";
import { Button } from "../ui/button";
import { FinishPicker } from "./FinishPicker";
import { TeammateModelPicker } from "./TeammateModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { attempt, teammatesApi } from "./teammatesActions";
import { LOOK_AROUND_PRESET_LABELS } from "./teammates.logic";
import { useTeammateManagement } from "./useTeammates";
import { toastManager } from "../ui/toast";

const SCRATCH = "__scratch__";

function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/60 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="tm-row-title">{title}</div>
        {hint ? <div className="tm-supporting">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NotifySwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field title={label}>
      <Switch aria-label={label} checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
    </Field>
  );
}

export function TeammateSettingsForm({
  teammate,
  onDelete,
}: {
  teammate: Teammate;
  onDelete?: () => void;
}) {
  const { update } = useTeammateManagement();
  const projects = useAtomValue(readModelStateAtom, (state) => state.projects);
  const [focus, setFocus] = useState(teammate.lookAround.focus);
  useEffect(() => setFocus(teammate.lookAround.focus), [teammate.id, teammate.lookAround.focus]);
  const [looking, setLooking] = useState(false);

  const patch = (value: Parameters<typeof update>[1]) => void update(teammate.id, value);

  return (
    <div className="flex max-w-2xl flex-col">
      <Field
        title="Model"
        hint={teammate.modelSelection ? "Chosen for this teammate." : "Uses your default model."}
      >
        <div className="flex items-center gap-2">
          <TeammateModelPicker
            value={teammate.modelSelection}
            onChange={(modelSelection) => patch({ modelSelection })}
          />
          {teammate.modelSelection ? (
            <Button size="xs" variant="ghost" onClick={() => patch({ modelSelection: null })}>
              Reset
            </Button>
          ) : null}
        </div>
      </Field>
      <div className="flex flex-col gap-2 border-t border-border/60 py-3">
        <div className="tm-row-title">Finish</div>
        <FinishPicker value={teammate.finish} onChange={(finish) => patch({ finish })} />
      </div>
      <Field title="Project" hint="Where its workers run. Chat works without one.">
        <Select
          value={teammate.projectId ?? SCRATCH}
          onValueChange={(value) =>
            patch({ projectId: value === SCRATCH ? null : (value as ProjectId) })
          }
        >
          <SelectTrigger className="w-40" aria-label="Project">
            <SelectValue>
              {projects.find((p) => p.id === teammate.projectId)?.name ?? "Scratch"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={SCRATCH}>
              Scratch
            </SelectItem>
            {projects.map((project) => (
              <SelectItem hideIndicator key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      <Field title="Paused" hint="Sleeps and stops looking around.">
        <Switch
          aria-label="Paused"
          checked={teammate.paused}
          onCheckedChange={(v) => patch({ paused: Boolean(v) })}
        />
      </Field>

      <h3 className="tm-section-title mt-4">Look around</h3>
      <Field title="Look around on a schedule" hint="Posts ideas under Up next. Read only.">
        <Switch
          aria-label="Look around on a schedule"
          checked={teammate.lookAround.enabled}
          onCheckedChange={(v) => patch({ lookAround: { enabled: Boolean(v) } })}
        />
      </Field>
      {teammate.lookAround.enabled ? (
        <>
          <Field title="How often">
            <Select
              value={teammate.lookAround.preset}
              onValueChange={(value) =>
                patch({ lookAround: { preset: value as TeammateLookAroundPreset } })
              }
            >
              <SelectTrigger className="w-44" aria-label="How often">
                <SelectValue>{LOOK_AROUND_PRESET_LABELS[teammate.lookAround.preset]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(LOOK_AROUND_PRESET_LABELS) as TeammateLookAroundPreset[]).map(
                  (preset) => (
                    <SelectItem hideIndicator key={preset} value={preset}>
                      {LOOK_AROUND_PRESET_LABELS[preset]}
                    </SelectItem>
                  ),
                )}
              </SelectPopup>
            </Select>
          </Field>
          <Field title="Most suggestions per look">
            <Select
              value={String(teammate.lookAround.maxSuggestions)}
              onValueChange={(value) => patch({ lookAround: { maxSuggestions: Number(value) } })}
            >
              <SelectTrigger className="w-20" aria-label="Most suggestions per look">
                <SelectValue>{teammate.lookAround.maxSuggestions}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <SelectItem hideIndicator key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5 border-t border-border/60 py-3">
            <div className="tm-row-title">Focus</div>
            <Textarea
              rows={2}
              aria-label="Focus"
              placeholder="What to pay attention to. Empty means general upkeep."
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              onBlur={() => {
                if (focus !== teammate.lookAround.focus) patch({ lookAround: { focus } });
              }}
            />
          </div>
        </>
      ) : null}
      <div className="flex justify-end pb-2">
        <Button
          size="sm"
          variant="outline"
          disabled={looking || teammate.paused}
          onClick={async () => {
            setLooking(true);
            const result = await attempt("Could not start a look around", () =>
              teammatesApi().lookAroundNow({ id: teammate.id }),
            );
            setLooking(false);
            if (result)
              toastManager.add({
                type: "info",
                title:
                  result.status === "busy"
                    ? `${teammate.name} is already looking around`
                    : `${teammate.name} is looking around`,
              });
          }}
        >
          Look around now
        </Button>
      </div>

      <h3 className="tm-section-title mt-4">Notify me when</h3>
      <NotifySwitch
        label="It needs me"
        checked={teammate.notify.needsYou}
        onChange={(needsYou) => patch({ notify: { needsYou } })}
      />
      <NotifySwitch
        label="Work is done"
        checked={teammate.notify.workDone}
        onChange={(workDone) => patch({ notify: { workDone } })}
      />
      <NotifySwitch
        label="It couldn't finish"
        checked={teammate.notify.couldntFinish}
        onChange={(couldntFinish) => patch({ notify: { couldntFinish } })}
      />
      {onDelete ? (
        <>
          <h3 className="tm-section-title mt-6">Remove</h3>
          <Field
            title={`Delete ${teammate.name}`}
            hint="Removes its memory, soul, to-dos and ideas. Its chat is archived; worker threads stay."
          >
            <Button size="sm" variant="destructive-outline" onClick={onDelete}>
              Delete…
            </Button>
          </Field>
        </>
      ) : null}
    </div>
  );
}
