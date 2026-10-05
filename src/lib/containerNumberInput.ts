// Typing rules for the two-box container number field (ContainerNumberInput):
// a 4-letter box on the letter keyboard, then a 7-digit box on the number pad.
// The pieces are kept here as pure functions so they can be tested without a DOM.

export const CONTAINER_PREFIX_LENGTH = 4;
export const CONTAINER_SERIAL_LENGTH = 7;

const isLetter = (ch: string) => ch >= "A" && ch <= "Z";
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/**
 * Filter raw text to the ISO 6346 shape: only letters are kept until there are
 * four, then only digits, up to seven. Anything else (spaces, dashes, a digit
 * in the prefix, a letter in the serial) is dropped, so "msku 123456-7"
 * becomes "MSKU1234567".
 */
export function filterContainerNumberInput(raw: string): string {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    if (out.length < CONTAINER_PREFIX_LENGTH) {
      if (isLetter(ch)) out += ch;
    } else if (out.length < CONTAINER_PREFIX_LENGTH + CONTAINER_SERIAL_LENGTH) {
      if (isDigit(ch)) out += ch;
    }
  }
  return out;
}

/**
 * Split a stored value into its letters and digits. Split on the leading run
 * of letters rather than at a fixed index, so a value whose prefix is being
 * corrected ("MKU1234567") keeps its digits in the digits box.
 */
export function splitContainerNumber(value: string): { prefix: string; serial: string } {
  let i = 0;
  while (i < value.length && i < CONTAINER_PREFIX_LENGTH && isLetter(value[i])) i++;
  return { prefix: value.slice(0, i), serial: value.slice(i) };
}

/**
 * Apply an edit made in the letters box. `raw` is the box's new text and
 * `serial` the digits already entered. Digits typed or pasted after a full
 * prefix overflow into the start of the serial (where the caret is, in a
 * single field), so pasting a whole number into the letters box fills both.
 * `overflow` is how many digits came in that way.
 */
export function applyLettersEdit(
  raw: string,
  serial: string,
): { value: string; overflow: number } {
  const typed = filterContainerNumberInput(raw);
  const prefix = typed.slice(0, CONTAINER_PREFIX_LENGTH);
  const extra = typed.slice(CONTAINER_PREFIX_LENGTH);
  const nextSerial = (extra + serial).slice(0, CONTAINER_SERIAL_LENGTH);
  return { value: prefix + nextSerial, overflow: extra.length };
}

/**
 * Apply an edit made in the digits box. A whole container number pasted there
 * replaces the value outright; anything else keeps only digits.
 */
export function applyDigitsEdit(raw: string, prefix: string): string {
  const whole = filterContainerNumberInput(raw);
  if (whole.length === CONTAINER_PREFIX_LENGTH + CONTAINER_SERIAL_LENGTH) return whole;
  return prefix + raw.replace(/[^0-9]/g, "").slice(0, CONTAINER_SERIAL_LENGTH);
}
