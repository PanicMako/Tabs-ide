import { ArrowRightIcon, CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { SetupCard, SETUP_ACTION_CLASS, SETUP_BACK_CLASS } from "./SetupCard";
import { WorkbenchPreview } from "./WorkbenchPreview";

type Appearance = "system" | "dark" | "light";
const ICONS = [
  { id: "system", label: "System", description: "Follows your appearance" },
  { id: "dark", label: "Dark", description: "A darker outline" },
  { id: "light", label: "Light", description: "A lighter outline" },
] as const;
const MODES = [
  { id: "system", label: "System", icon: MonitorIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "light", label: "Light", icon: SunIcon },
] as const;

function StepFooter({
  step,
  onBack,
  onNext,
  nextLabel,
  disabled = false,
}: {
  readonly step: string;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly nextLabel: string;
  readonly disabled?: boolean;
}) {
  return (
    <div className="mt-7 flex items-center justify-between gap-3 border-t border-white/15 pt-5">
      <button type="button" disabled={disabled} onClick={onBack} className={SETUP_BACK_CLASS}>
        <ArrowRightIcon aria-hidden="true" className="size-3.5 rotate-180" />
        Back<span className="sr-only"> to previous setup step</span>
      </button>
      <span className="hidden text-xs text-white/65 sm:block">{step}</span>
      <button type="button" disabled={disabled} onClick={onNext} className={SETUP_ACTION_CLASS}>
        {nextLabel}
        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

export function AppIconStep({
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  readonly selected: Appearance;
  readonly onSelect: (value: Appearance) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  return (
    <SetupCard labelledBy="setup-icon-title">
      <div className="grid items-center gap-10 py-3 md:grid-cols-[1fr_1.05fr] md:gap-12 md:py-6">
        <div>
          <p className="mb-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">
            A familiar face
          </p>
          <h2
            id="setup-icon-title"
            style={{ fontFamily: "'Syne', sans-serif" }}
            className="text-[38px] font-semibold leading-[1.08] tracking-[-0.05em] text-white sm:text-[46px]"
          >
            Choose your
            <br />
            app icon.
          </h2>
          <p className="mt-6 max-w-xs text-sm leading-7 text-white/75">
            The same Tabs, with a look that feels at home in your Dock and app switcher.
          </p>
          <p className="mt-4 text-xs text-white/60">You can change it anytime in Settings.</p>
        </div>
        <div className="rounded-[32px] border border-white/25 bg-white/90 p-4 text-neutral-800 shadow-xl shadow-black/15 sm:p-5">
          <div role="group" aria-label="App icon style" className="grid grid-cols-3 gap-2">
            {ICONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected === item.id}
                aria-label={`${item.label} app icon`}
                onClick={() => onSelect(item.id)}
                className={`relative flex min-w-0 flex-col items-center gap-5 rounded-[24px] px-2 pb-6 pt-10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700 ${selected === item.id ? "bg-white shadow-sm ring-1 ring-black/10" : "hover:bg-white/60"}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border ${selected === item.id ? "border-neutral-700 bg-neutral-700 text-white" : "border-neutral-400/50"}`}
                >
                  {selected === item.id && <CheckIcon className="size-2.5" />}
                </span>
                <img
                  src={`/onboarding/app-icon-${item.id}.png`}
                  alt=""
                  className="size-16 rounded-[20px] shadow-md sm:size-24"
                />
                <span className="text-xs font-semibold">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <StepFooter
        step="02 / App icon"
        onBack={onBack}
        onNext={onNext}
        nextLabel="Choose appearance"
      />
    </SetupCard>
  );
}

export function AppearanceStep({
  selected,
  resolvedMode,
  onSelect,
  onBack,
  onLaunch,
  launching,
}: {
  readonly selected: Appearance;
  readonly resolvedMode: "light" | "dark";
  readonly onSelect: (value: Appearance) => void;
  readonly onBack: () => void;
  readonly onLaunch: () => void;
  readonly launching: boolean;
}) {
  return (
    <SetupCard labelledBy="setup-appearance-title">
      <div className="grid items-center gap-10 py-3 md:grid-cols-[1fr_1.05fr] md:gap-12 md:py-6">
        <div>
          <p className="mb-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">
            Set the mood
          </p>
          <h2
            id="setup-appearance-title"
            style={{ fontFamily: "'Syne', sans-serif" }}
            className="text-[38px] font-semibold leading-[1.08] tracking-[-0.05em] text-white sm:text-[46px]"
          >
            Choose your
            <br />
            appearance.
          </h2>
          <p className="mt-6 max-w-xs text-sm leading-7 text-white/75">
            Light, dark, or in step with your system. Find the space you like working in.
          </p>
          <p className="mt-4 max-w-xs text-xs leading-6 text-white/60">
            More themes, fonts, and editor colors are waiting in Settings.
          </p>
        </div>
        <div>
          <div
            role="group"
            aria-label="Interface appearance"
            className="mb-4 flex gap-1 rounded-full border border-white/25 bg-white/15 p-1.5"
          >
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                aria-label={`${label} appearance`}
                onClick={() => onSelect(id)}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${selected === id ? "bg-white text-neutral-800 shadow-sm" : "text-white/80 hover:bg-white/10"}`}
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <WorkbenchPreview mode={resolvedMode} />
          <p className="mt-4 text-center text-[10px] text-white/60">
            Appearance preview · Frost surface
          </p>
        </div>
      </div>
      <StepFooter
        step="03 / Appearance"
        onBack={onBack}
        onNext={onLaunch}
        nextLabel={launching ? "Opening Tabs..." : "Enter Tabs"}
        disabled={launching}
      />
    </SetupCard>
  );
}
