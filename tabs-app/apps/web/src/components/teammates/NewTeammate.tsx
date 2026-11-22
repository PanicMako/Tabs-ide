import type { ModelSelection, ProjectId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { ShuffleIcon } from "lucide-react";
import { useState } from "react";
import { readModelStateAtom } from "~/state/readModel";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { FinishPicker } from "./FinishPicker";
import { TemplateCarousel } from "./TemplateCarousel";
import { TeammateModelPicker } from "./TeammateModelPicker";
import { normalizeTeammateName, uniqueTeammateName } from "./teammates.logic";
import {
  CUSTOM_TEMPLATE_ID,
  GENERALIST_TEMPLATE_ID,
  STAGE_TEMPLATES,
  startingSoul,
  suggestTeammateNames,
  templateById,
} from "./teammateTemplates";
import { DEFAULT_EMBLEM, EMBLEMS } from "./RoleArt";
import { useTeammateManagement, useTeammatesData } from "./useTeammates";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { attempt, teammatesApi } from "./teammatesActions";

const SCRATCH = "__scratch__";

/** The New teammate flow: pick a starting point, name it, pick how it looks, create it. */
export function NewTeammate({ firstOne, onDone }: { firstOne: boolean; onDone: () => void }) {
  const { teammates } = useTeammatesData();
  const { create, update } = useTeammateManagement();
  const projects = useAtomValue(readModelStateAtom, (state) => state.projects);
  const [templateId, setTemplateId] = useState(GENERALIST_TEMPLATE_ID);
  const template = templateById(templateId);
  const [name, setName] = useState(() => uniqueTeammateName(template.name, teammates));
  const [finish, setFinish] = useState(template.finish);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [ideas, setIdeas] = useState(0);
  const [emblem, setEmblem] = useState(DEFAULT_EMBLEM);
  const [purpose, setPurpose] = useState("");
  const [creating, setCreating] = useState(false);
  const [writing, setWriting] = useState(false);
  const [soulOpen, setSoulOpen] = useState(false);
  /** What the writing model drafted, and the name and purpose it was drafted for. */
  const [profile, setProfile] = useState<{
    key: string;
    soul: string;
    focus: string;
  } | null>(null);
  const cleanName = normalizeTeammateName(name) ?? "";

  const pick = (id: string) => {
    const next = templateById(id);
    setTemplateId(id);
    setName(uniqueTeammateName(next.name, teammates));
    setFinish(next.finish);
  };

  const isCustom = template.id === CUSTOM_TEMPLATE_ID;
  const profileKey = `${cleanName}|${purpose.trim()}`;
  const draft = isCustom && profile?.key === profileKey ? profile : null;

  /** Ask the chosen model to write the soul and look-around focus from what it is for. */
  const writeProfile = async () => {
    if (!cleanName || purpose.trim() === "" || writing) return null;
    setWriting(true);
    const result = await attempt("Could not write the soul", () =>
      teammatesApi().generateProfile({
        name: cleanName,
        purpose: purpose.trim(),
        ...(model ? { modelSelection: model } : {}),
      }),
    );
    setWriting(false);
    if (!result) return null;
    const made = { key: profileKey, ...result };
    setProfile(made);
    setSoulOpen(true);
    return made;
  };

  const submit = async () => {
    if (!cleanName || creating || writing) return;
    setCreating(true);
    // A custom teammate writes itself: if the soul has not been drafted for this name and purpose
    // yet, the model does it now. A failed draft falls back to a plain starting soul.
    const written = isCustom && purpose.trim() !== "" ? (draft ?? (await writeProfile())) : null;
    const created = await create({
      name: cleanName,
      soul: written?.soul ?? startingSoul(template, cleanName, purpose),
      finish,
      ...(model ? { modelSelection: model } : {}),
      ...(projectId ? { projectId } : {}),
    });
    if (created && written?.focus)
      await update(created.id, { lookAround: { focus: written.focus } });
    setCreating(false);
    if (created) {
      toastManager.add({
        type: "success",
        title: `${created.name} joined`,
        description: template.line,
      });
      onDone();
    }
  };

  const names = suggestTeammateNames(teammates, 4, ideas);
  return (
    <ScrollArea scrollFade className="min-h-0 flex-1">
      <div className="mx-auto w-full max-w-3xl px-8 py-7 pe-16">
        <form
          className="flex min-w-0 flex-col gap-7"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="tm-name">{firstOne ? "Create your first teammate" : "New teammate"}</h2>
            <p className="tm-supporting max-w-prose leading-relaxed">
              A teammate is an AI colleague with a name, a personality and a memory. Pick a starting
              point. You can change everything later.
            </p>
          </div>

          <fieldset className="tm-step">
            <legend className="tm-step-head">
              <span className="tm-step-num" aria-hidden="true">
                1
              </span>
              <span className="tm-section-title">Start from</span>
            </legend>
            <TemplateCarousel
              templates={STAGE_TEMPLATES}
              selectedId={templateId}
              onSelect={pick}
              emblem={emblem}
              customEditor={
                <div className="flex w-full max-w-md flex-col items-center gap-3 pt-1">
                  <div role="radiogroup" aria-label="Emblem" className="tm-flow-emblems">
                    {EMBLEMS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={emblem === id}
                        aria-label={label}
                        className="tm-emblem no-drag"
                        onClick={() => setEmblem(id)}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  <div className="flex w-full items-center gap-2">
                    <Input
                      aria-label="What is it for?"
                      placeholder="What is it for? e.g. keeps our changelog honest"
                      maxLength={200}
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={writing || !cleanName || purpose.trim() === ""}
                      onClick={() => void writeProfile()}
                    >
                      {writing ? <Spinner className="size-3.5" /> : null}
                      Write it
                    </Button>
                  </div>
                  <p className="tm-meta max-w-sm text-center">
                    {cleanName || "It"} is written by the model chosen under Set up: its soul and
                    what it looks out for. Read it below before you create it.
                  </p>
                </div>
              }
            />
          </fieldset>

          <div className="tm-step">
            <div className="tm-step-head">
              <span className="tm-step-num" aria-hidden="true">
                2
              </span>
              <label className="tm-section-title" htmlFor="new-teammate-name">
                Name
              </label>
            </div>
            <Input
              id="new-teammate-name"
              className="max-w-80"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {names.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="tm-meta me-1">Ideas</span>
                {names.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    className="tm-chip no-drag"
                    onClick={() => setName(idea)}
                  >
                    {idea}
                  </button>
                ))}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="More name ideas"
                  onClick={() => setIdeas((value) => value + 4)}
                >
                  <ShuffleIcon />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="tm-step">
            <div className="tm-step-head">
              <span className="tm-step-num" aria-hidden="true">
                3
              </span>
              <h3 className="tm-section-title">Finish</h3>
            </div>
            <FinishPicker value={finish} onChange={setFinish} />
          </div>

          <div className="tm-step">
            <div className="tm-step-head">
              <span className="tm-step-num" aria-hidden="true">
                4
              </span>
              <h3 className="tm-section-title">Set up</h3>
            </div>
            <div className="flex flex-wrap gap-8">
              <div className="flex flex-col gap-2">
                <h4 className="tm-supporting">Model</h4>
                <TeammateModelPicker value={model} onChange={setModel} />
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="tm-supporting">
                  Project{template.needsProject ? "" : " (optional)"}
                </h4>
                <Select
                  value={projectId ?? SCRATCH}
                  onValueChange={(value) =>
                    setProjectId(value === SCRATCH ? null : (value as ProjectId))
                  }
                >
                  <SelectTrigger className="w-48" aria-label="Project">
                    <SelectValue>
                      {projects.find((p) => p.id === projectId)?.name ?? "Decide later"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem hideIndicator value={SCRATCH}>
                      Decide later
                    </SelectItem>
                    {projects.map((project) => (
                      <SelectItem hideIndicator key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
          </div>

          <Collapsible open={soulOpen} onOpenChange={setSoulOpen}>
            <CollapsibleTrigger className="tm-meta no-drag">
              {draft ? "Its soul, written for you" : "Its starting soul"}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className="tm-mono tm-supporting mt-2 max-h-56 overflow-auto whitespace-pre-wrap">
                {draft?.soul ?? startingSoul(template, cleanName || template.name, purpose)}
              </pre>
            </CollapsiblePanel>
          </Collapsible>

          <div className="tm-create-bar">
            <Button type="submit" disabled={!cleanName || creating || writing}>
              {writing || creating ? <Spinner className="size-3.5" /> : null}
              {writing
                ? `Writing ${cleanName}…`
                : isCustom && purpose.trim() !== ""
                  ? `Write and create ${cleanName || "teammate"}`
                  : `Create ${cleanName || "teammate"}`}
            </Button>
            {firstOne ? null : (
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>
    </ScrollArea>
  );
}
