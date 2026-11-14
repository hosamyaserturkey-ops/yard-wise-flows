import { Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/i18n";
import type { Lang } from "@/i18n/messages";
import { cn } from "@/lib/utils";

const LANGS: Lang[] = ["en", "ar"];

const Shell = () => {
  const { lang, dir, setLang, t } = useI18n();
  const { signOut } = useAuth();
  return (
    // dir and lang are set here, not on <html>: the staff app stays left to right.
    <div dir={dir} lang={lang} className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 sm:px-6">
          <h1 className="flex-1 truncate text-base font-semibold sm:text-lg">{t("app.name")}</h1>
          <div role="group" aria-label={t("lang.switch")} className="inline-flex rounded-md border p-0.5">
            {LANGS.map((l) => (
              <Button
                key={l}
                type="button"
                size="sm"
                variant={lang === l ? "default" : "ghost"}
                aria-pressed={lang === l}
                lang={l}
                className={cn("min-h-10 px-3", l === "ar" && "font-medium")}
                onClick={() => setLang(l)}
              >
                {t(`lang.${l}`)}
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="min-h-10" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 me-1 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("nav.signOut")}</span>
            <span className="sr-only sm:hidden">{t("nav.signOut")}</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
};

/** The manufacturer's own, separate layout: no staff menu, English or Arabic. */
const PortalLayout = () => (
  <I18nProvider>
    <Shell />
  </I18nProvider>
);

export default PortalLayout;
