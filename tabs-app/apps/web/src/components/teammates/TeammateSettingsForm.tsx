import type { ProjectId, Teammate, TeammateLookAroundPreset } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { readModelStateAtom } from "~/state/readModel";
import { Button } from "../ui/button";
import { FinishPicker } from "./FinishPicker";
import { NotchPlate } from "./NotchPlate";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { TeammateModelPicker } from "./TeammateModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { attempt, teammatesApi } from "./teammatesActions";
import { finishName, LOOK_AROUND_PRESET_LABELS, normalizeTeammateName } from "./teammates.logic";
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
    <li className="tm-line" data-center="true">
      <div className="tm-line-body">
        <div className="tm-line-title">{title}</div>
        {hint ? <div className="tm-supporting">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <div className="tm-setting-head">
        <h3 className="tm-section-title">{title}</h3>
        {hint ? <p className="tm-supporting mt-1">{hint}</p> : null}
      </div>
      <ul className="tm-group">{children}</ul>
    </section>
  );
}

/** The teammate's name, renamed right here: Enter or leaving the field saves, Escape puts it back. */
function NameField({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const commit = () => {
    const next = normalizeTeammateName(value, name);
    if (next) onSave(next);
    else setValue(name);
  };
  return (
    <Field title="Name" hint="What it is called in chats and on your screen.">
      <Input
        aria-label="Rename teammate"
        className="w-48"
        maxLength={64}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            setValue(name);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
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
    <div className="tm-page">
      <div className="tm-page-head">
        <div>
          <h2 className="tm-page-title">Settings</h2>
          <p className="tm-page-lede">
            How {teammate.name} looks, which model it thinks with, and when it speaks up.
          </p>
        </div>
      </div>

      <Section title="General">
        <NameField name={teammate.name} onSave={(name) => patch({ name })} />
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
        <Field title="Finish" hint={finishName(teammate.finish)}>
          <Popover>
            <PopoverTrigger
              render={<Button size="sm" variant="outline" aria-label="Change finish" />}
            >
              <NotchPlate finish={teammate.finish} className="size-5" avatarClassName="size-4" />
              Change
            </PopoverTrigger>
            <PopoverPopup align="end" className="tm-orbit-popup" viewportClassName="!p-4">
              <FinishPicker value={teammate.finish} onChange={(finish) => patch({ finish })} />
            </PopoverPopup>
          </Popover>
        </Field>
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
      </Section>

      <Section
        title="Look around"
        hint="Let it read your project now and then and post ideas under Up next."
      >
        <Field title="Look around on a schedule" hint="Read only. It never changes anything.">
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
            <li className="tm-line flex-col !items-stretch gap-2">
              <div className="tm-line-title">Focus</div>
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
            </li>
          </>
        ) : null}
        <Field title="Look around now" hint="Run one pass right away.">
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
        </Field>
      </Section>

      <Section title="Notify me when">
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
      </Section>

      {onDelete ? (
        <Section title="Remove">
          <Field
            title={`Delete ${teammate.name}`}
            hint="Removes its memory, soul, to-dos and ideas. Its chat is archived; worker threads stay."
          >
            <Button size="sm" variant="destructive-outline" onClick={onDelete}>
              Delete…
            </Button>
          </Field>
        </Section>
      ) : null}
    </div>
  );
}
