import { supabase } from "@/integrations/supabase/client";

// Fallback list — used for typing and as a bootstrap default before the
// shipping_lines table has loaded (or if the fetch fails).
export const SHIPPING_LINES = [
  "SLG",
  "SLD",
  "SFT",
  "7Seas",
  "WOM",
  "EEL",
  "INX",
  "ICR",
  "EMK",
  "BLT",
  "AXL",
  "XSL",
  "TRL",
] as const;

export type ShippingLine = (typeof SHIPPING_LINES)[number] | string;

export interface ShippingLineRow {
  id: string;
  code: string;
  name: string;
  contact_email: string | null;
  default_free_days: number;
  default_daily_demurrage: number | null;
  active: boolean;
}

/**
 * Fetch active shipping lines from the database. Falls back to the static
 * SHIPPING_LINES list if the query fails so dropdowns always have options.
 */
export async function fetchShippingLines(): Promise<ShippingLineRow[]> {
  const { data, error } = await supabase
    .from("shipping_lines")
    .select("*")
    .eq("active", true)
    .order("code");
  if (error || !data) {
    console.error("Failed to load shipping_lines:", error);
    return SHIPPING_LINES.map((code) => ({
      id: code,
      code,
      name: code,
      contact_email: null,
      default_free_days: 7,
      default_daily_demurrage: null,
      active: true,
    }));
  }
  return data as ShippingLineRow[];
}
