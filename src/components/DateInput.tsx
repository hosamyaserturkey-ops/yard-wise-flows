import { useEffect, useState } from "react";
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
