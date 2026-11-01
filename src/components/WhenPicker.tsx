import { Minus, Plus } from "lucide-react";

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayLabel(date: Date, index: number) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

/** Custom date/time picker. `value` is "" (now) or "YYYY-MM-DDTHH:mm". */
export function WhenPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const base = value ? new Date(value) : new Date();
  const selected = Number.isNaN(base.getTime()) ? new Date() : base;
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  const selectedDay = startOfDay(selected).getTime();

  const set = (date: Date) => onChange(toLocalValue(date));
  const shift = (minutes: number) => {
    const next = new Date(selected);
    next.setMinutes(next.getMinutes() + minutes);
    set(next);
  };
  const pickDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    set(next);
  };

  const stepper =
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1">
        <button
          type="button"
          aria-label="15 minutes earlier"
          onClick={() => shift(-15)}
          className={stepper}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span
          className="min-w-[3.5rem] text-center font-mono text-sm font-semibold tabular-nums"
          aria-live="polite"
        >
          {value ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}` : "Now"}
        </span>
        <button
          type="button"
          aria-label="15 minutes later"
          onClick={() => shift(15)}
          className={stepper}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5">
        {days.map((day, index) => {
          const active = Boolean(value) && day.getTime() === selectedDay;
          return (
            <button
              key={day.getTime()}
              type="button"
              aria-pressed={active}
              onClick={() => pickDay(day)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              {dayLabel(day, index)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
