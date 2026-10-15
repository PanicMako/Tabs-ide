export function wordmarkSize(
  available: number,
  measuredWidth: number,
  measuredFontSize: number,
  gapEm = 0.24,
): number {
  if (
    ![available, measuredWidth, measuredFontSize].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return 0;
  return (
    Math.floor((Math.max(0, available - 1) / (measuredWidth / measuredFontSize + gapEm)) * 100) /
    100
  );
}
