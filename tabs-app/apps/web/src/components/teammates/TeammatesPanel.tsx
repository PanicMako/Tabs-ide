import type { Teammate } from "@tabs/contracts";
import { PlusIcon, XIcon, PinIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { MotionEnter } from "../ui/motion-enter";
import { ScrollArea } from "../ui/scroll-area";
import { NewTeammate } from "./NewTeammate";
import { NotchAvatar } from "./NotchAvatar";
import { TeammateMain } from "./TeammateMain";
import { activityFor, formatBadge, openSuggestionCount, railStatus } from "./teammates.logic";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";
import { useTeammatesData } from "./useTeammates";
import "./teammates.css";

function RailRow({
  teammate,
  selected,
  pinned,
  onSelect,
}: {
  teammate: Teammate;
  selected: boolean;
  pinned: boolean;
  onSelect: () => void;
}) {
  const snapshot = useTeammatesStore((state) => state.snapshot);
  const activity = activityFor(snapshot?.activity ?? [], teammate.id);
  const ideas = openSuggestionCount(snapshot?.suggestions ?? [], teammate.id);
  const attention = activity.needsYouCount > 0;
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-selected={selected}
      className="tm-rail-row no-drag"
      onClick={onSelect}
    >
      <NotchAvatar className="size-9 shrink-0" finish={teammate.finish} mood={activity.mood} />
      <span className="min-w-0 flex-1 text-left">
        <span className="tm-row-title flex items-center gap-1.5">
          <span className="truncate">{teammate.name}</span>
          {pinned ? (
            <PinIcon
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="On your screen"
            />
          ) : null}
        </span>
        <span className={cn("tm-supporting block truncate", attention && "text-foreground")}>
          {railStatus(activity, ideas, teammate.paused)}
        </span>
      </span>
      {attention ? (
        <span className="tm-count" aria-label={`${activity.needsYouCount} need you`}>
          {formatBadge(activity.needsYouCount)}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The Teammates space: a roomy surface with a rail of teammates on the left and the selected
 * teammate (or the New teammate flow) on the right. It sits below the window's title bar and is
 * marked no-drag so every control inside it receives clicks in the desktop app.
 */
export function TeammatesPanel() {
  const open = useTeammatesUiStore((state) => state.panelOpen);
  const setOpen = useTeammatesUiStore((state) => state.setPanelOpen);
  const mode = useTeammatesUiStore((state) => state.spaceMode);
  const setMode = useTeammatesUiStore((state) => state.setSpaceMode);
  const setActive = useTeammatesUiStore((state) => state.setActiveTeammateId);
  const { teammates, active, pinned, snapshot } = useTeammatesData();
  const creating = mode === "new" || (snapshot !== null && teammates.length === 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        backdropClassName="no-drag"
        className="tm-space no-drag h-[min(760px,calc(100dvh-112px))] w-[min(1080px,calc(100vw-48px))] max-w-none overflow-hidden rounded-(--radius-preview) max-sm:h-[calc(100dvh-72px)]"
      >
        <DialogTitle className="sr-only">Teammates</DialogTitle>
        <DialogDescription className="sr-only">
          Your AI teammates, what they are working on, and what they need from you.
        </DialogDescription>
        <div className="flex min-h-0 flex-1">
          <aside
            className="tm-rail flex w-64 shrink-0 flex-col max-md:hidden"
            aria-label="Teammates"
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="tm-section-title">Teammates</h2>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="New teammate"
                className="no-drag"
                onClick={() => setMode("new")}
              >
                <PlusIcon />
              </Button>
            </div>
            <ScrollArea scrollFade className="min-h-0 flex-1">
              <div className="flex flex-col gap-0.5 px-2 pb-3">
                {teammates.map((teammate) => (
                  <RailRow
                    key={teammate.id}
                    teammate={teammate}
                    selected={!creating && active?.id === teammate.id}
                    pinned={pinned?.id === teammate.id && teammates.length > 1}
                    onSelect={() => {
                      setActive(teammate.id);
                      setMode("teammate");
                    }}
                  />
                ))}
                <button
                  type="button"
                  data-selected={creating}
                  className="tm-rail-row no-drag"
                  onClick={() => setMode("new")}
                >
                  <span className="tm-rail-plus">
                    <PlusIcon className="size-4" />
                  </span>
                  <span className="tm-row-title">New teammate</span>
                </button>
              </div>
            </ScrollArea>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            {creating ? (
              <MotionEnter key="new" className="flex min-h-0 flex-1 flex-col">
                <NewTeammate firstOne={teammates.length === 0} onDone={() => setMode("teammate")} />
              </MotionEnter>
            ) : active ? (
              <MotionEnter key={active.id} className="flex min-h-0 flex-1 flex-col">
                <TeammateMain teammate={active} />
              </MotionEnter>
            ) : (
              <p className="tm-supporting p-8">Getting your teammate ready…</p>
            )}
          </section>
        </div>
        <DialogClose
          aria-label="Close Teammates"
          className="no-drag absolute end-3 top-3 z-10"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <XIcon />
        </DialogClose>
      </DialogPopup>
    </Dialog>
  );
}
