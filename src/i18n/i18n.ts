import { createContext, useContext } from "react";
import { MESSAGES, type Lang, type Message, type MessageKey, type PluralCategory } from "./messages";

export const LANG_STORAGE_KEY = "cy.portalLang";

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ar";
}

/** Arabic is written right to left. */
export const dirOf = (lang: Lang): "ltr" | "rtl" => (lang === "ar" ? "rtl" : "ltr");

/** First visit: the browser's language if it is Arabic, else English. */
export function detectLang(browserLanguages: readonly string[] | undefined): Lang {
  const first = browserLanguages?.[0]?.toLowerCase() ?? "";
  return first.startsWith("ar") ? "ar" : "en";
}

/** Replaces each {name} with its value. A missing value is left visible, not hidden. */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/**
 * Which form of a word a count takes. English has two. Arabic has six: none,
 * one, two (a special dual), 3 to 10, 11 to 99, and everything else.
 */
export function pluralCategory(lang: Lang, n: number): PluralCategory {
  if (lang === "en") return n === 1 ? "one" : "other";
  const whole = Math.abs(Math.trunc(n));
  if (whole === 0) return "zero";
  if (whole === 1) return "one";
  if (whole === 2) return "two";
  const last2 = whole % 100;
  if (last2 >= 3 && last2 <= 10) return "few";
  if (last2 >= 11 && last2 <= 99) return "many";
  return "other";
}

/** The text for a message: a plain string, or the plural form that fits {n}. */
export function pick(message: Message, lang: Lang, params?: Record<string, string | number>): string {
  if (typeof message === "string") return message;
  const n = typeof params?.n === "number" ? params.n : Number(params?.n);
  const form = Number.isFinite(n) ? pluralCategory(lang, n) : "other";
  return message[form] ?? message.other;
}

export function translate(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const message = MESSAGES[lang][key] ?? MESSAGES.en[key];
  return message === undefined ? key : interpolate(pick(message, lang, params), params);
}

export interface I18nValue {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nValue | undefined>(undefined);

export const useI18n = (): I18nValue => {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within an I18nProvider");
  return value;
};
