import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate, parseDateInput, toDate, toIsoDay } from "@/lib/format";

interface DateInputProps {
  id?: string;
  /** "YYYY-MM-DD", or "" for no date — the same value a native date input uses. */
  value: string;
  onChange: (value: string) => void;
  /** Latest selectable day, "YYYY-MM-DD". */
  max?: string;
  min?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Drop-in replacement for <Input type="date">. The browser's own date box
 * shows its language's format (mm/dd/yyyy on English-US machines); this one
 * always shows "01 Oct 2026". Staff can still type the date, day first
 * ("01/10/2026", "01102026"), or pick it from the calendar.
 */
export function DateInput({ id, value, onChange, max, min, disabled, className, placeholder = "DD/MM/YYYY" }: DateInputProps) {
  const [draft, setDraft] = useState(value ? formatDate(value) : "");
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  // Follow changes made outside the box (clear filters, a prefilled form),
  // but keep a mistyped entry on screen so its error stays visible.
  useEffect(() => {
    if (focused) return;
    setDraft((current) => ((parseDateInput(current) ?? "") === value ? current : value ? formatDate(value) : ""));
  }, [value, focused]);

  const invalid = draft.trim() !== "" && parseDateInput(draft) === null;

  const handleType = (text: string) => {
    setDraft(text);
    // A partial or impossible date clears the value rather than leaving the
    // previous date in force behind text that says something else.
    onChange(parseDateInput(text) ?? "");
  };

  const maxDate = max ? toDate(max) : undefined;
  const minDate = min ? toDate(min) : undefined;
  const thisYear = new Date().getFullYear();

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={cn("pr-10", invalid && "border-destructive focus-visible:ring-destructive")}
        onFocus={() => setFocused(true)}
        onChange={(e) => handleType(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseDateInput(draft);
          if (parsed) setDraft(formatDate(parsed));
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Pick a date from the calendar"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={value ? toDate(value) : undefined}
            defaultMonth={value ? toDate(value) : maxDate}
            onSelect={(d) => {
              if (!d) return;
              const iso = toIsoDay(d);
              onChange(iso);
              setDraft(formatDate(iso));
              setOpen(false);
            }}
            disabled={[...(maxDate ? [{ after: maxDate }] : []), ...(minDate ? [{ before: minDate }] : [])]}
            captionLayout="dropdown-buttons"
            classNames={{
              caption_label: "hidden",
              caption_dropdowns: "flex justify-center gap-1",
              dropdown: "h-8 rounded-md border border-input bg-background px-2 text-sm",
              dropdown_icon: "hidden",
              vhidden: "sr-only",
            }}
            fromYear={2020}
            toYear={thisYear + 1}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {invalid && !focused && (
        <p className="mt-1 text-xs text-destructive">Type the date as DD/MM/YYYY, e.g. 01/10/2026.</p>
      )}
    </div>
  );
}

const parseTime = (text: string): string | null => {
  const m = text.trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
};

interface DateTimeInputProps {
  id?: string;
  /** "YYYY-MM-DDTHH:mm" (the datetime-local format), or "". */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Replacement for <Input type="datetime-local">: a DateInput plus a 24-hour
 * time box. The value only changes once both halves are valid, so a
 * half-typed correction can never be saved as an empty time.
 */
export function DateTimeInput({ id, value, onChange, disabled }: DateTimeInputProps) {
  const [datePart = "", timePart = ""] = value ? value.split("T") : [];
  const [time, setTime] = useState(timePart);
  const [timeFocused, setTimeFocused] = useState(false);

  // Reset the box only when the saved time itself changes (another record,
  // a reset form); a mistyped time stays on screen with its error.
  const lastTimePart = useRef(timePart);
  useEffect(() => {
    if (timePart === lastTimePart.current) return;
    lastTimePart.current = timePart;
    if (!timeFocused) setTime(timePart);
  }, [timePart, timeFocused]);

  const timeInvalid = time.trim() !== "" && parseTime(time) === null;

  return (
    <div className="grid grid-cols-[1fr_6rem] gap-2">
      <DateInput
        id={id}
        value={datePart}
        disabled={disabled}
        onChange={(d) => {
          const t = parseTime(time);
          if (d && t) onChange(`${d}T${t}`);
        }}
      />
      <div>
        <Input
          aria-label="Time (24-hour)"
          value={time}
          disabled={disabled}
          placeholder="HH:MM"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={timeInvalid || undefined}
          className={cn("font-mono", timeInvalid && "border-destructive focus-visible:ring-destructive")}
          onFocus={() => setTimeFocused(true)}
          onChange={(e) => {
            setTime(e.target.value);
            const t = parseTime(e.target.value);
            if (t && datePart) onChange(`${datePart}T${t}`);
          }}
          onBlur={() => {
            setTimeFocused(false);
            const t = parseTime(time);
            if (t) setTime(t);
          }}
        />
        {timeInvalid && !timeFocused && <p className="mt-1 text-xs text-destructive">Use HH:MM, e.g. 22:07.</p>}
      </div>
    </div>
  );
}
