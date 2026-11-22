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
import { NotchAvatar } from "./NotchAvatar";
import { TeammateModelPicker } from "./TeammateModelPicker";
import { normalizeTeammateName, uniqueTeammateName } from "./teammates.logic";
import {
  suggestTeammateNames,
  TEAMMATE_TEMPLATES,
  templateById,
  GENERALIST_TEMPLATE_ID,
} from "./teammateTemplates";
import { useTeammateManagement, useTeammatesData } from "./useTeammates";
import { toastManager } from "../ui/toast";

const SCRATCH = "__scratch__";

/** The New teammate flow: pick a starting point, name it, pick how it looks, create it. */
export function NewTeammate({ firstOne, onDone }: { firstOne: boolean; onDone: () => void }) {
  const { teammates } = useTeammatesData();
  const { create } = useTeammateManagement();
  const projects = useAtomValue(readModelStateAtom, (state) => state.projects);
  const [templateId, setTemplateId] = useState(GENERALIST_TEMPLATE_ID);
  const template = templateById(templateId);
  const [name, setName] = useState(() => uniqueTeammateName(template.name, teammates));
  const [finish, setFinish] = useState(template.finish);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [ideas, setIdeas] = useState(0);
  const [creating, setCreating] = useState(false);
  const cleanName = normalizeTeammateName(name) ?? "";

  const pick = (id: string) => {
    const next = templateById(id);
    setTemplateId(id);
    setName(uniqueTeammateName(next.name, teammates));
    setFinish(next.finish);
  };

  const submit = async () => {
    if (!cleanName || creating) return;
    setCreating(true);
    const created = await create({
      name: cleanName,
      soul: template.soul.replace(/^# .*/m, `# ${cleanName}`),
      finish,
      ...(model ? { modelSelection: model } : {}),
      ...(projectId ? { projectId } : {}),
    });
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
      <div className="grid gap-10 px-8 py-7 pe-16 lg:grid-cols-[minmax(0,1fr)_260px]">
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

          <fieldset className="flex flex-col gap-2">
            <legend className="tm-section-title mb-1">Start from</legend>
            <div
              role="radiogroup"
              aria-label="Starting point"
              className="grid gap-2 sm:grid-cols-2"
            >
              {TEAMMATE_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === templateId}
                  className="tm-template no-drag"
                  data-selected={item.id === templateId}
                  onClick={() => pick(item.id)}
                >
                  <span className="tm-row-title">{item.title}</span>
                  <span className="tm-supporting">{item.line}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <label className="tm-section-title" htmlFor="new-teammate-name">
              Name
            </label>
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

          <div className="flex flex-col gap-2">
            <h3 className="tm-section-title">Finish</h3>
            <FinishPicker value={finish} onChange={setFinish} />
          </div>

          <div className="flex flex-wrap gap-8">
            <div className="flex flex-col gap-2">
              <h3 className="tm-section-title">Model</h3>
              <TeammateModelPicker value={model} onChange={setModel} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="tm-section-title">
                Project{template.needsProject ? "" : " (optional)"}
              </h3>
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

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!cleanName || creating}>
              Create {cleanName || "teammate"}
            </Button>
            {firstOne ? null : (
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            )}
          </div>
        </form>

        <aside
          className="flex flex-col items-center gap-3 self-start text-center max-lg:hidden"
          aria-label="Preview"
        >
          <div className="tm-portrait tm-portrait-large">
            <NotchAvatar className="size-36" finish={finish} mood="idle" />
          </div>
          <div className="tm-name">{cleanName || "Your teammate"}</div>
          <p className="tm-supporting leading-relaxed">{template.line}</p>
          <Collapsible className="w-full text-left">
            <CollapsibleTrigger className="tm-meta no-drag w-full text-center">
              Its starting soul
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className="tm-mono tm-supporting mt-2 max-h-48 overflow-hidden whitespace-pre-wrap">
                {template.soul.replace(/^# .*/m, `# ${cleanName || template.name}`)}
              </pre>
            </CollapsiblePanel>
          </Collapsible>
        </aside>
      </div>
    </ScrollArea>
  );
}
