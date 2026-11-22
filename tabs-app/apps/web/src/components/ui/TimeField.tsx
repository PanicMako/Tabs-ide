import { cn } from "~/lib/utils";
import { SimpleSelect } from "./simple-select";

/** "HH:MM" (24h) -> Date today at that time; null when malformed. */
export function timeOfDayToDate(value: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function dateToTimeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatTimeOfDay(value: string): string {
  const date = timeOfDayToDate(value);
  if (!date) return "Set time";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const HOURS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));
const MINUTES = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, "0"),
}));
const PERIODS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

/**
 * Themed replacement for `<input type="time">`: hour, minute and AM/PM pickers built on the
 * themed select. Value is a 24h "HH:MM" string.
 */
export function TimeField({
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  "aria-label": string;
  className?: string | undefined;
  disabled?: boolean;
}) {
  const date = timeOfDayToDate(value) ?? timeOfDayToDate("09:00")!;
  const hours24 = date.getHours();
  const minute = date.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const emit = (h12: number, m: number, p: string) => {
    const h24 = (h12 % 12) + (p === "PM" ? 12 : 0);
    onValueChange(`${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <SimpleSelect
        aria-label={`${ariaLabel} hour`}
        disabled={disabled}
        className="min-w-14"
        value={String(hour12)}
        options={HOURS}
        onValueChange={(next) => emit(Number(next), minute, period)}
      />
      <span aria-hidden="true" className="text-muted-foreground">
        :
      </span>
      <SimpleSelect
        aria-label={`${ariaLabel} minute`}
        disabled={disabled}
        className="min-w-14"
        value={String(minute)}
        options={MINUTES}
        onValueChange={(next) => emit(hour12, Number(next), period)}
      />
      <SimpleSelect
        aria-label={`${ariaLabel} period`}
        disabled={disabled}
        className="min-w-16"
        value={period}
        options={PERIODS}
        onValueChange={(next) => emit(hour12, minute, next)}
      />
    </div>
  );
}
