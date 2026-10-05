import { useRef } from "react";
import { flushSync } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CONTAINER_PREFIX_LENGTH,
  applyDigitsEdit,
  applyLettersEdit,
  splitContainerNumber,
} from "@/lib/containerNumberInput";

interface ContainerNumberInputProps {
  /** The full number, letters then digits (e.g. "MSKU1234567"). */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Container number entry for phones: a box for the 4 letters on the letter
 * keyboard, then a box for the 7 digits on the number pad. Focus moves to the
 * digits box as soon as the fourth letter is typed.
 *
 * Two boxes rather than one field with a changing inputmode: iOS keeps showing
 * the keyboard it opened with when inputmode changes on a focused field, and
 * only picks the new one up when focus moves to another input.
 */
export function ContainerNumberInput({ value, onChange, className }: ContainerNumberInputProps) {
  const lettersRef = useRef<HTMLInputElement>(null);
  const digitsRef = useRef<HTMLInputElement>(null);
  const { prefix, serial } = splitContainerNumber(value);
  const prefixDone = prefix.length === CONTAINER_PREFIX_LENGTH;

  const handleLetters = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value: next, overflow } = applyLettersEdit(e.target.value, serial);
    const nextPrefixDone = splitContainerNumber(next).prefix.length === CONTAINER_PREFIX_LENGTH;
    if (!nextPrefixDone || (prefixDone && overflow === 0)) {
      onChange(next);
      return;
    }
    // The digits box is disabled until the prefix is complete, so commit the
    // new value before moving focus there, or focus() lands on a disabled input.
    flushSync(() => onChange(next));
    const digits = digitsRef.current;
    if (!digits) return;
    digits.focus();
    const caret = overflow > 0 ? overflow : digits.value.length;
    digits.setSelectionRange(caret, caret);
  };

  const handleDigitsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    // Backspace at the start of the digits deletes the last letter, as it would
    // in a single field, and hands the caret back to the letter keyboard.
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      lettersRef.current?.focus();
      onChange(prefix.slice(0, -1) + serial);
    }
  };

  const box = "h-16 text-center font-mono text-xl tracking-widest md:text-xl";

  return (
    <div role="group" aria-label="Container number" className={cn("flex gap-2", className)}>
      <Input
        ref={lettersRef}
        value={prefix}
        onChange={handleLetters}
        placeholder="SLDX"
        aria-label="Container letters"
        className={cn(box, "w-32 shrink-0 uppercase")}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        autoCapitalize="characters"
        enterKeyHint="next"
      />
      <Input
        ref={digitsRef}
        value={serial}
        onChange={(e) => onChange(applyDigitsEdit(e.target.value, prefix))}
        onKeyDown={handleDigitsKeyDown}
        disabled={!prefixDone}
        placeholder="1234567"
        aria-label="Container numbers"
        className={cn(box, "min-w-0 flex-1")}
        autoComplete="off"
        inputMode="numeric"
        enterKeyHint="done"
      />
    </div>
  );
}
