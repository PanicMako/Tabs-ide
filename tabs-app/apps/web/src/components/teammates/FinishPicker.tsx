import type { TeammateFinish } from "@tabs/contracts";
import { FinishOrbit } from "./FinishOrbit";

/** Pick a finish on the orbit dial; the dial's middle shows the mascot wearing it. */
export function FinishPicker({
  value,
  onChange,
}: {
  value: TeammateFinish;
  onChange: (finish: TeammateFinish) => void;
}) {
  return <FinishOrbit value={value} onChange={onChange} />;
}
