import { useEffect, useId, useRef, useState } from "react";
import { Clock, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
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

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
function TimeWheel({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const scrolling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const index = values.indexOf(value);
  useEffect(() => {
    if (!scrolling.current) ref.current?.scrollTo({ top: index * 36, behavior: "instant" });
  }, [index]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${id}-${value}`}
      tabIndex={0}
      onWheel={() => {
        scrolling.current = true;
      }}
      onPointerDown={() => {
        scrolling.current = true;
      }}
      onScroll={() => {
        if (!scrolling.current) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const next = Math.max(
            0,
            Math.min(values.length - 1, Math.round((ref.current?.scrollTop ?? 0) / 36)),
          );
          scrolling.current = false;
          callback.current(values[next]!);
          ref.current?.scrollTo({ top: next * 36, behavior: "smooth" });
        }, 100);
      }}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        scrolling.current = false;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? values.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + values.length) % values.length;
        onChange(values[next]!);
      }}
      className="h-[180px] flex-1 overflow-y-auto overscroll-contain snap-y snap-mandatory rounded-lg py-[72px] outline-none focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {values.map((item) => (
        <div
          id={`${id}-${item}`}
          key={item}
          role="option"
          aria-selected={item === value}
          onClick={() => {
            scrolling.current = false;
            onChange(item);
          }}
          className={`flex h-9 snap-center cursor-pointer items-center justify-center font-mono ${item === value ? "text-xl font-semibold text-foreground" : "text-base text-muted-foreground/60"}`}
        >
          {label === "Minutes" ? String(item).padStart(2, "0") : item}
        </div>
      ))}
    </div>
  );
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
  const [now, setNow] = useState(Date.now);
  const initial =
    value && Number.isFinite(value.getTime())
      ? value
      : new Date(Math.ceil((Date.now() + 15 * 60_000) / 60_000) * 60_000);
  const [selected, setSelected] = useState(initial);
  const [calendarMode, setCalendarMode] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const valid = selected.getTime() > Math.max(now, minDate?.getTime() ?? now);
  const dayText = localDateText(selected);
  const today = localDateText(new Date(now));
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateText(tomorrowDate);
  const choose = (date: Date) => {
    setSelected(date);
    setCalendarMode(false);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setNow(Date.now());
  };
  const chooseDay = (day: Date) => {
    const date = new Date(day);
    date.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    choose(date);
  };
  const changeTime = (hour: number, minute: number) => {
    const date = new Date(selected);
    date.setHours(hour, minute, 0, 0);
    setSelected(date);
  };
  const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const ampm = selected.getHours() >= 12 ? "pm" : "am";
  return (
    <form
      className="w-full p-5 text-foreground"
      aria-label="Schedule message"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (selected.getTime() > Math.max(Date.now(), minDate?.getTime() ?? Date.now()))
          onConfirm?.(selected);
        else setNow(Date.now());
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl italic">Schedule</h2>
          <p className="mt-1 text-xs text-muted-foreground">Pick a date. Scroll to set the time.</p>
        </div>
        <Clock size={18} className="mt-1 text-muted-foreground" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <section aria-label="Choose date">
          <SegmentedControl
            size="sm"
            className="mb-3 w-full [&>button]:flex-1"
            aria-label="Schedule day"
            value={
              calendarMode
                ? "custom"
                : dayText === today
                  ? "today"
                  : dayText === tomorrow
                    ? "tomorrow"
                    : "custom"
            }
            onValueChange={(day) => {
              if (day === "today") chooseDay(new Date(now));
              if (day === "tomorrow") chooseDay(tomorrowDate);
              if (day === "custom") {
                setCalendarMode(true);
                calendarRef.current?.focus();
              }
            }}
            options={[
              { value: "today", label: "Today" },
              { value: "tomorrow", label: "Tomorrow" },
              { value: "custom", label: "Calendar" },
            ]}
          />
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="text-xs font-medium">
              {month.toLocaleDateString([], { month: "long", year: "numeric" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
          <div
            ref={calendarRef}
            tabIndex={-1}
            className="grid grid-cols-7 gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="group"
            aria-label="Calendar days"
          >
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <span key={day} className="text-center text-[10px] text-muted-foreground">
                {day}
              </span>
            ))}
            {Array.from({ length: first }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: days }, (_, index) => {
              const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
              const active = localDateText(date) === dayText;
              const past = localDateText(date) < today;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={past}
                  aria-label={date.toLocaleDateString([], {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  aria-pressed={active}
                  onClick={() => chooseDay(date)}
                  className={`h-8 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25 ${active ? "bg-foreground text-background font-semibold" : "hover:bg-muted"}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </section>
        <section aria-label="Choose time" className="min-w-0">
          <p className="mb-2 text-center font-mono text-xl tabular-nums">
            {selected.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
          <div className="relative flex items-center rounded-xl border border-border bg-muted/25 px-3">
            <div className="pointer-events-none absolute inset-x-2 top-[72px] h-9 rounded-lg bg-muted/70" />
            <TimeWheel
              label="Hours"
              values={HOURS}
              value={selected.getHours() % 12 || 12}
              onChange={(hour) =>
                changeTime((hour % 12) + (ampm === "pm" ? 12 : 0), selected.getMinutes())
              }
            />
            <span className="text-muted-foreground">:</span>
            <TimeWheel
              label="Minutes"
              values={MINUTES}
              value={selected.getMinutes()}
              onChange={(minute) => changeTime(selected.getHours(), minute)}
            />
            <div className="flex flex-col gap-2">
              {(["am", "pm"] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  aria-pressed={ampm === period}
                  onClick={() =>
                    changeTime(
                      (selected.getHours() % 12) + (period === "pm" ? 12 : 0),
                      selected.getMinutes(),
                    )
                  }
                  className={`rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${ampm === period ? "bg-card text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {period.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-1">
            {[15, 30, 60].map((minutes) => (
              <Button
                key={minutes}
                type="button"
                size="sm"
                variant="ghost"
                className="flex-1 px-1 text-xs"
                onClick={() =>
                  choose(new Date(Math.ceil((Date.now() + minutes * 60_000) / 60_000) * 60_000))
                }
              >
                +{minutes === 60 ? "1 hour" : `${minutes} min`}
              </Button>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
          {valid
            ? `${selected.toLocaleDateString([], { month: "short", day: "numeric" })} · ${selected.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`
            : "Choose a future time."}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
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
