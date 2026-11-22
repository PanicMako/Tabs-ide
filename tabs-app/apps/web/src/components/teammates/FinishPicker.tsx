import type { TeammateFinish } from "@tabs/contracts";
import { NotchAvatar } from "./NotchAvatar";
import { FINISH_OPTIONS } from "./teammates.logic";

/** Pick a finish by looking at it: each option is the mascot in that finish. */
export function FinishPicker({
  value,
  onChange,
}: {
  value: TeammateFinish;
  onChange: (finish: TeammateFinish) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Finish" className="flex flex-wrap gap-2">
      {FINISH_OPTIONS.map((finish) => (
        <button
          key={finish.id}
          type="button"
          role="radio"
          aria-checked={value === finish.id}
          aria-label={finish.name}
          className="tm-finish no-drag"
          data-selected={value === finish.id}
          onClick={() => onChange(finish.id)}
        >
          <NotchAvatar finish={finish.id} className="size-9" />
          <span className="tm-meta">{finish.name}</span>
        </button>
      ))}
    </div>
  );
}
