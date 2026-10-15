const utcFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
/** Keep the source timestamp separately (datetime/title) when rendering this label. */
export function utcTimeLabel(timestamp: string) {
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? `${utcFormatter.format(milliseconds)} UTC` : timestamp;
}
