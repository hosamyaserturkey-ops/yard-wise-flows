import { useCallback, useMemo, useState } from "react";
import { I18nContext, LANG_STORAGE_KEY, detectLang, dirOf, isLang, translate, type I18nValue } from "./i18n";
import type { Lang } from "./messages";

function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* private mode: fall through to the browser language */ }
  return detectLang(typeof navigator === "undefined" ? undefined : navigator.languages);
}

/** The language the person chose is remembered on this device. */
export const I18nProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem(LANG_STORAGE_KEY, next); } catch { /* not remembered, still works */ }
  }, []);
  const value = useMemo<I18nValue>(
    () => ({ lang, dir: dirOf(lang), setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
