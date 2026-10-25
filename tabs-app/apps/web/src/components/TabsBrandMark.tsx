import { useResolvedBrandVariant } from "../hooks/useDesktopIconTheme";
import { TABS_LOGO_VARIANTS, TABS_MARK, type TabsLogoVariant } from "@tabs/shared/tabsBrand";

/** Static artwork; motion belongs only to the marketing site's intro. */
export function TabsBrandMark({
  variant,
  symbol = false,
  className = "",
  label = "Tabs",
}: {
  variant?: TabsLogoVariant;
  symbol?: boolean;
  className?: string;
  label?: string;
}) {
  const resolved = useResolvedBrandVariant();
  const colors = TABS_LOGO_VARIANTS.find((item) => item.id === (variant ?? resolved))!;
  if (colors.id === "blue-ink") {
    return (
      <img src="/brand/blue-ink-master.png" alt={label} className={`rounded-[22%] ${className}`} />
    );
  }
  return (
    <svg
      viewBox={symbol ? "0 0 390 390" : "0 0 1024 1024"}
      className={className}
      role="img"
      aria-label={label}
    >
      {!symbol && <rect width="1024" height="1024" rx="224" fill={colors.bg} />}
      <g transform={symbol ? undefined : "translate(145 144) scale(1.88)"} fill={colors.fg}>
        <path fillRule="evenodd" d={TABS_MARK.main} />
        <path d={TABS_MARK.detached} />
      </g>
    </svg>
  );
}
