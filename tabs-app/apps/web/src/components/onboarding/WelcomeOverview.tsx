import { ArrowRightIcon } from "lucide-react";
import { SetupCard, SETUP_ACTION_CLASS } from "./SetupCard";
import { WorkbenchPreview } from "./WorkbenchPreview";

export function WelcomeOverview({ onNext }: { readonly onNext: () => void }) {
  return (
    <SetupCard labelledBy="welcome-overview-title" step={1}>
      <div className="grid grid-cols-1 items-center gap-8 py-3 md:grid-cols-[1fr_1.1fr] md:gap-10 md:py-5">
        <div className="min-w-0">
          <p className="mb-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/90">
            Welcome to Tabs
          </p>
          <h2
            id="welcome-overview-title"
            className="setup-headline setup-welcome-headline text-white"
          >
            <span className="block">
              Bigger than
              <br />
              an IDE.
            </span>
            <span className="setup-heading-accent block text-[#dce4ff]">One window.</span>
          </h2>
          <p className="setup-supporting-copy mt-6 max-w-sm text-base leading-7 text-white/90">
            A full IDE, coding agents, and your tools. One tab per project.
          </p>
          <p className="setup-supporting-copy mt-4 max-w-sm text-sm leading-6 text-white/90">
            Add websites like Figma or terminal commands like Claude and Codex CLI. Keep only the
            tools you use.
          </p>
        </div>
        <div className="min-w-0" data-slot="setup-welcome-preview">
          <WorkbenchPreview />
        </div>
      </div>
      <div className="mt-7 flex items-center justify-between border-t border-white/15 pt-5">
        <span className="text-xs text-white/90">
          01{" "}
          <span aria-hidden="true" className="mx-2 text-white/30">
            /
          </span>{" "}
          Welcome
        </span>
        <button type="button" onClick={onNext} className={SETUP_ACTION_CLASS}>
          Make it yours <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </SetupCard>
  );
}
