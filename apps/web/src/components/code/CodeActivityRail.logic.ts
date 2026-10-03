import type { CustomActivityBarItem } from "@tabs/shared/codeChrome";

export function getVisibleCustomActivityBarItems(
  items: readonly CustomActivityBarItem[] | undefined,
): readonly CustomActivityBarItem[] {
  return (items ?? [])
    .filter((item) => item.location !== "auxiliaryBar")
    .toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0));
}
