import type { Teammate } from "@tabs/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CircleHelpIcon,
  MessageSquareIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { MotionEnter } from "../ui/motion-enter";
import { ScrollArea } from "../ui/scroll-area";
import { NotchAvatar } from "./NotchAvatar";
import { TeammateIntro } from "./TeammateIntro";
import { TeammateMemory } from "./TeammateMemory";
import { TeammateAsk } from "./TeammateAsk";
import { TeammateOverview } from "./TeammateOverview";
import { TeammateSettingsForm } from "./TeammateSettingsForm";
import { TeammateSoul } from "./TeammateSoul";
import { openHomeChat } from "./teammatesActions";
import {
  activityFor,
  normalizeTeammateName,
  openSuggestionCount,
  statusSentence,
} from "./teammates.logic";
import { TEAMMATE_TEMPLATES } from "./teammateTemplates";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";
import { useTeammateManagement } from "./useTeammates";

const SECTIONS = [
  { id: "now", label: "Now" },
  { id: "memory", label: "Memory" },
  { id: "soul", label: "Soul" },
  { id: "settings", label: "Settings" },
] as const;
export type TeammateSection = (typeof SECTIONS)[number]["id"];

/** The name, editable in place: click it (or Rename) to type, Enter saves, Escape cancels. */
function InlineName({
  name,
  editing,
  onEdit,
  onSave,
}: {
  name: string;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Rename ${name}`}
        className="tm-name no-drag group flex max-w-full items-center gap-2 text-left"
        onClick={() => {
          setValue(name);
          onEdit(true);
        }}
      >
        <span className="truncate">{name}</span>
        <PencilIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    );
  }
  const commit = () => {
    const next = normalizeTeammateName(value, name);
    if (next) onSave(next);
    onEdit(false);
  };
  return (
    <Input
      autoFocus
      aria-label="Teammate name"
      className="no-drag h-9 max-w-72"
      maxLength={64}
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          event.stopPropagation();
          onEdit(false);
        }
      }}
    />
  );
}

export function TeammateMain({ teammate }: { teammate: Teammate }) {
  const navigate = useNavigate();
  const snapshot = useTeammatesStore((state) => state.snapshot);
  const { update, remove, confirmDialog } = useTeammateManagement();
  const introSeen = useTeammatesUiStore((state) => state.introSeen);
  const setIntroSeen = useTeammatesUiStore((state) => state.setIntroSeen);
  const setPanelOpen = useTeammatesUiStore((state) => state.setPanelOpen);
  const setPinned = useTeammatesUiStore((state) => state.setPinnedTeammateId);
  const setCornerHidden = useTeammatesUiStore((state) => state.setCornerHidden);
  const [section, setSection] = useState<TeammateSection>("now");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  if (!snapshot) return null;

  const activity = activityFor(snapshot.activity, teammate.id);
  const ideas = openSuggestionCount(snapshot.suggestions, teammate.id);
  const busy = activity.mood === "thinking";
  const openChat = async () => {
    if (await openHomeChat(teammate.id, navigate)) setPanelOpen(false);
  };

  return (
    <>
      <header className="flex items-start gap-5 px-8 pt-6 pb-3 pe-16">
        <div className="tm-portrait shrink-0">
          <NotchAvatar className="size-20" finish={teammate.finish} mood={activity.mood} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1.5">
          <div className="flex items-center gap-1">
            <InlineName
              name={teammate.name}
              editing={renaming}
              onEdit={setRenaming}
              onSave={(name) => void update(teammate.id, { name })}
            />
            <Menu>
              <MenuTrigger
                aria-label={`More for ${teammate.name}`}
                className="no-drag"
                render={<Button size="icon-xs" variant="ghost" />}
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuItem onClick={() => setRenaming(true)}>
                  <PencilIcon /> Rename
                </MenuItem>
                <MenuItem onClick={() => void openChat()}>
                  <MessageSquareIcon /> Open its chat
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setPinned(teammate.id);
                    setCornerHidden(false);
                  }}
                >
                  <PinIcon /> Show on my screen
                </MenuItem>
                <MenuItem onClick={() => void update(teammate.id, { paused: !teammate.paused })}>
                  {teammate.paused ? <SunIcon /> : <MoonIcon />}
                  {teammate.paused ? "Resume" : "Pause"}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setIntroSeen(false);
                    setSection("now");
                  }}
                >
                  <CircleHelpIcon /> How teammates work
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => void remove(teammate)}>
                  <Trash2Icon /> Delete {teammate.name}…
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
          <p className="tm-status" aria-live="polite">
            {statusSentence(teammate.name, activity, ideas, teammate.paused)}
          </p>
        </div>
      </header>
      <div className="px-8 pb-3">
        <TeammateAsk
          teammate={teammate}
          busy={busy}
          starters={[]}
          draft={draft}
          onDraftChange={setDraft}
          onOpenChat={() => void openChat()}
        />
      </div>
      <div role="tablist" aria-label={`${teammate.name} sections`} className="tm-tabs">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={cn("tm-tab no-drag")}
            onClick={() => setSection(item.id)}
          >
            {item.label}
            {item.id === "now" && activity.needsYouCount > 0 ? (
              <span className="tm-count ms-1.5">{activity.needsYouCount}</span>
            ) : null}
          </button>
        ))}
      </div>
      <ScrollArea scrollFade className="min-h-0 flex-1">
        <MotionEnter key={section} className="flex flex-col gap-6 px-8 py-6">
          {section === "now" ? (
            <>
              {!introSeen ? (
                <TeammateIntro
                  name={teammate.name}
                  starters={TEAMMATE_TEMPLATES[0]!.asks}
                  onPick={setDraft}
                  onDismiss={() => setIntroSeen(true)}
                />
              ) : null}
              <TeammateOverview
                snapshot={snapshot}
                teammate={teammate}
                onGoToSettings={() => setSection("settings")}
                onOpenChat={() => void openChat()}
              />
            </>
          ) : section === "memory" ? (
            <TeammateMemory teammate={teammate} refreshKey={teammate.updatedAt} />
          ) : section === "soul" ? (
            <TeammateSoul teammate={teammate} />
          ) : (
            <TeammateSettingsForm teammate={teammate} onDelete={() => void remove(teammate)} />
          )}
        </MotionEnter>
      </ScrollArea>
      {confirmDialog}
    </>
  );
}
