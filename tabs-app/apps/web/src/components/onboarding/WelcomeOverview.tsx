import { ArrowRightIcon } from "lucide-react";
import { SetupCard, SETUP_ACTION_CLASS } from "./SetupCard";
import { WorkbenchPreview } from "./WorkbenchPreview";

export function WelcomeOverview({ onNext }: { readonly onNext: () => void }) {
  return (
    <SetupCard labelledBy="welcome-overview-title">
      <div className="grid items-center gap-10 py-3 md:grid-cols-[1fr_1.2fr] md:gap-12 md:py-6">
        <div>
          <p className="mb-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">
            Welcome to Tabs
          </p>
          <h2
            id="welcome-overview-title"
            style={{ fontFamily: "'Syne', sans-serif" }}
            className="text-[42px] font-semibold leading-[1.04] tracking-[-0.055em] text-white sm:text-[54px]"
          >
            Bigger than
            <br />
            an IDE.
            <br />
            <span className="text-[#b8c9ff]">One window.</span>
          </h2>
          <p className="mt-6 max-w-xs text-sm leading-7 text-white/75">
            A full IDE, coding agents, and your tools. One tab per project.
          </p>
          <p className="mt-4 max-w-xs text-xs leading-6 text-white/65">
            Add websites like Figma or terminal commands like Claude and Codex CLI. Keep only the
            tools you use.
          </p>
        </div>
        <div>
          <WorkbenchPreview />
        </div>
      </div>
      <div className="mt-7 flex items-center justify-between border-t border-white/15 pt-5">
        <span className="text-xs text-white/65">
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
