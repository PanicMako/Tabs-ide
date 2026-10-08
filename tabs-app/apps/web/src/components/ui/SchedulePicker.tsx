import { useEffect, useId, useState } from "react";
import { Clock, ArrowRight } from "lucide-react";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";

export function localDateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseSchedule(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(year!, month! - 1, day!, hour!, minute!, 0, 0);
  return result.getFullYear() === year &&
    result.getMonth() === month! - 1 &&
    result.getDate() === day &&
    result.getHours() === hour &&
    result.getMinutes() === minute
    ? result
    : null;
}
export function SchedulePicker({
  value,
  onConfirm,
  onCancel,
  minDate,
}: {
  value?: Date | undefined;
  onConfirm?: ((date: Date) => void) | undefined;
  onCancel?: (() => void) | undefined;
  minDate?: Date | undefined;
}) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const initial =
    value && Number.isFinite(value.getTime())
      ? value
      : new Date(Math.ceil((Date.now() + 15 * 60_000) / 60_000) * 60_000);
  const [date, setDate] = useState(() => localDateText(initial));
  const [time, setTime] = useState(() => initial.toTimeString().slice(0, 5));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const selected = parseSchedule(date, time);
  const earliest = Math.max(now, minDate?.getTime() ?? now);
  const valid = selected !== null && selected.getTime() > earliest;
  const today = localDateText(new Date(now));
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateText(tomorrowDate);
  const choose = (next: Date) => {
    setDate(localDateText(next));
    setTime(next.toTimeString().slice(0, 5));
    setNow(Date.now());
  };
  return (
    <form
      className="w-[320px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-card p-4 text-foreground shadow-lg"
      aria-label="Schedule message"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (selected && selected.getTime() > Math.max(Date.now(), minDate?.getTime() ?? Date.now()))
          onConfirm?.(selected);
        else setNow(Date.now());
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-xl italic">Schedule</h2>
        <Clock size={16} className="text-muted-foreground" />
      </div>
      <SegmentedControl
        size="sm"
        className="mb-3 w-full [&>button]:flex-1"
        aria-label="Schedule day"
        value={date === today ? "today" : date === tomorrow ? "tomorrow" : "custom"}
        onValueChange={(day) => {
          if (day !== "custom") setDate(day === "today" ? today : tomorrow);
          else document.getElementById(`${id}-date`)?.focus();
        }}
        options={[
          { value: "today", label: "Today" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "custom", label: "Custom" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-date`}>
          Date
          <input
            id={`${id}-date`}
            type="text"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            placeholder="YYYY-MM-DD"
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-time`}>
          Time · 24h
          <input
            id={`${id}-time`}
            type="text"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            placeholder="HH:MM"
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-1.5">
        {[15, 30, 60].map((minutes) => (
          <Button
            key={minutes}
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1 rounded-full text-xs"
            onClick={() =>
              choose(new Date(Math.ceil((Date.now() + minutes * 60_000) / 60_000) * 60_000))
            }
          >
            +{minutes === 60 ? "1 hour" : `${minutes} min`}
          </Button>
        ))}
      </div>
      <p role="status" className="my-3 text-xs leading-relaxed text-muted-foreground">
        {valid
          ? `${selected!.toLocaleDateString([], { month: "short", day: "numeric" })} · ${selected!.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}. Sends when the agent is ready.`
          : selected
            ? "Choose a future time."
            : "Enter a valid date and time."}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid}>
          Schedule
          <ArrowRight size={13} />
        </Button>
      </div>
    </form>
  );
}
