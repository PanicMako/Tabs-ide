export interface SnoozePreset {
  readonly id: "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";
  readonly label: string;
  readonly whenLabel: string;
  readonly snoozedUntil: string;
}

const HOUR_MS = 60 * 60 * 1_000;

const atHour = (date: Date, hour: number) => {
  const result = new Date(date);
  result.setHours(hour, 0, 0, 0);
  return result;
};

const labelTime = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function resolveSnoozePresets(now = new Date()): ReadonlyArray<SnoozePreset> {
  const make = (
    id: SnoozePreset["id"],
    label: string,
    wake: Date,
    whenLabel = labelTime(wake),
  ): SnoozePreset => ({ id, label, whenLabel, snoozedUntil: wake.toISOString() });
  const presets: SnoozePreset[] = [
    make("hour", "In 1 hour", new Date(now.getTime() + HOUR_MS)),
    make("three-hours", "In 3 hours", new Date(now.getTime() + 3 * HOUR_MS)),
  ];
  const evening = atHour(now, 18);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push(make("evening", "This evening", evening));
  }
  const tomorrow = atHour(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), 9);
  presets.push(make("tomorrow", "Tomorrow", tomorrow));
  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = atHour(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday),
    9,
  );
  if (nextWeek.getTime() !== tomorrow.getTime()) {
    presets.push(
      make(
        "next-week",
        "Next week",
        nextWeek,
        `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${labelTime(nextWeek)}`,
      ),
    );
  }
  return presets;
}
