import { BlocksIcon, PlugZapIcon, PinIcon } from "lucide-react";
import { SegmentedControl } from "../ui/segmented-control";

export type ProviderView = "connection" | "models";
export function ProviderFocusBar({
  view,
  onChange,
  modelCount,
  pinnedCount,
}: {
  view: ProviderView;
  onChange: (view: ProviderView) => void;
  modelCount: number;
  pinnedCount: number;
}) {
  return (
    <div className="provider-focus-bar">
      <SegmentedControl
        orbitKind="spotlight"
        aria-label="Provider workspace view"
        value={view}
        onValueChange={(value) => onChange(value as ProviderView)}
        options={[
          { value: "connection", label: "Connection", icon: <PlugZapIcon size={14} aria-hidden /> },
          { value: "models", label: "Models", icon: <BlocksIcon size={14} aria-hidden /> },
        ]}
        size="sm"
      />
      <span className="provider-catalog-meta">
        <BlocksIcon size={12} aria-hidden />
        {modelCount} models<span aria-hidden>·</span>
        <PinIcon size={12} aria-hidden />
        {pinnedCount} pinned
      </span>
    </div>
  );
}
