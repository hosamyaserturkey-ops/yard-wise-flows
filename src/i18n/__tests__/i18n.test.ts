import { describe, expect, it } from "vitest";
import { ar, en } from "../messages";
import { detectLang, dirOf, interpolate, isLang, pluralCategory, translate } from "../i18n";
import { formatPortalDate, formatPortalDateTime } from "@/lib/portalDates";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** Every text a message can show: the string, or each plural form. */
const forms = (m: unknown): string[] => (typeof m === "string" ? [m] : Object.values(m as Record<string, string>));
/** The placeholders a message uses, across all its forms (a form may skip {n}, e.g. "one car"). */
const used = (m: unknown) => new Set(forms(m).flatMap(placeholders));

describe("messages", () => {
  it("has an Arabic string for every English one, and no extras", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses the same {placeholders} in both languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect([...used(ar[key])].sort(), key).toEqual([...used(en[key])].sort());
    }
  });

  it("only puts known {placeholders} in any plural form", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      for (const text of [...forms(en[key]), ...forms(ar[key])]) {
        for (const name of placeholders(text)) expect(["n", "name", "when"], `${key}: ${name}`).toContain(name);
      }
    }
  });

  it("gives every plural message an 'other' form", () => {
    for (const m of [...Object.values(en), ...Object.values(ar)]) {
      if (typeof m !== "string") expect(typeof (m as { other?: string }).other).toBe("string");
    }
  });

  it("never leaves an Arabic string empty", () => {
    for (const [key, m] of Object.entries(ar)) for (const text of forms(m)) expect(text.trim(), key).not.toBe("");
  });

  it("translates every inspection photo angle the staff form can take", async () => {
    const { SHOTS, DAMAGE_ANGLE } = await import("@/lib/inspection");
    for (const id of [...SHOTS.map((s) => s.id), DAMAGE_ANGLE]) {
      expect(`angle.${id}` in en, `angle.${id}`).toBe(true);
    }
  });

  it("translates every fuel level and visit status", async () => {
    const { FUEL_LEVELS } = await import("@/lib/inspection");
    const { VISIT_STATUS_LABEL } = await import("@/lib/carLot");
    for (const f of FUEL_LEVELS) expect(`fuel.${f.id}` in en, f.id).toBe(true);
    for (const s of Object.keys(VISIT_STATUS_LABEL)) expect(`status.${s}` in en, s).toBe(true);
  });
});

describe("interpolate / translate", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(interpolate("{n} cars", { n: 3 })).toBe("3 cars");
    expect(interpolate("{n} of {m}", { n: 3 })).toBe("3 of {m}");
    expect(interpolate("plain")).toBe("plain");
  });

  it("translates into either language, with the right plural", () => {
    expect(translate("en", "stock.count", { n: 1 })).toBe("1 car");
    expect(translate("en", "stock.count", { n: 2 })).toBe("2 cars");
    expect(translate("ar", "stock.count", { n: 0 })).toBe("لا توجد سيارات");
    expect(translate("ar", "stock.count", { n: 1 })).toBe("سيارة واحدة");
    expect(translate("ar", "stock.count", { n: 2 })).toBe("سيارتان");
    expect(translate("ar", "stock.count", { n: 7 })).toBe("7 سيارات");
    expect(translate("ar", "stock.count", { n: 11 })).toBe("11 سيارة");
    expect(translate("ar", "stock.count", { n: 100 })).toBe("100 سيارة");
    expect(translate("ar", "stock.overFree", { n: 4 })).toBe("تجاوزت الأيام المجانية بـ 4 أيام");
    expect(translate("ar", "stock.overFree", { n: 12 })).toBe("تجاوزت الأيام المجانية بـ 12 يومًا");
    expect(translate("ar", "stock.overFree", { n: 2 })).toBe("تجاوزت الأيام المجانية بيومين");
  });
});

describe("pluralCategory", () => {
  it("English has one and other", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 5)).toBe("other");
  });
  it("Arabic follows the six-form rule", () => {
    const cat = (n: number) => pluralCategory("ar", n);
    expect([0, 1, 2, 3, 10, 11, 99, 100, 101, 102, 103, 111, 200, 1003].map(cat)).toEqual(
      ["zero", "one", "two", "few", "few", "many", "many", "other", "other", "other", "few", "many", "other", "few"],
    );
  });
});

describe("language helpers", () => {
  it("reads right to left for Arabic only", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });

  it("starts in Arabic only when the browser prefers it", () => {
    expect(detectLang(["ar-JO", "en"])).toBe("ar");
    expect(detectLang(["AR"])).toBe("ar");
    expect(detectLang(["en-GB", "ar"])).toBe("en");
    expect(detectLang([])).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });

  it("accepts only the two languages", () => {
    expect(isLang("ar")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});

describe("portal dates", () => {
  const d = new Date(2026, 10, 10, 9, 5);
  it("writes the month in each language with 0-9 digits", () => {
    expect(formatPortalDate(d, "en")).toBe("10 Nov 2026");
    expect(formatPortalDate(d, "ar")).toBe("10 تشرين الثاني 2026");
    expect(formatPortalDateTime(d, "en")).toBe("10 Nov 2026 09:05");
  });
  it("shows a dash for a bad date", () => {
    expect(formatPortalDate("nope", "en")).toBe("—");
  });
});
