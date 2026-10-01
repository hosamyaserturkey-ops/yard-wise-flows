import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { buildPortListRows, type PortListEntry, type PortListRow, type VisitLite } from "@/lib/portListStatus";

// `.in()` filters travel in the URL, so long lists are fetched in slices.
const SLICE = 150;

const slices = <T,>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += SLICE) out.push(items.slice(i, i + SLICE));
  return out;
};

/**
 * Every visit of the given containers, keyed by container number. Scoped to a
 * yard when one is given, since port lists are kept per yard.
 */
export async function fetchVisitsFor(
  containerNumbers: string[],
  yardId: string | null,
): Promise<Map<string, VisitLite[]>> {
  const byNumber = new Map<string, VisitLite[]>();
  const unique = Array.from(new Set(containerNumbers));
  const idToNumber = new Map<string, string>();
  for (const part of slices(unique)) {
    const { data, error } = await supabase.from("containers").select("id, container_number").in("container_number", part);
    if (error) throw error;
    for (const c of data ?? []) idToNumber.set(c.id, c.container_number);
  }
  for (const part of slices(Array.from(idToNumber.keys()))) {
    let q = supabase
      .from("container_visits")
      .select("container_id, yard_id, gate_in_time, gate_out_time, port_arrival_date, free_days")
      .in("container_id", part);
    if (yardId) q = q.eq("yard_id", yardId);
    const { data, error } = await q;
    if (error) throw error;
    for (const v of data ?? []) {
      const number = idToNumber.get(v.container_id);
      if (!number) continue;
      const list = byNumber.get(number) ?? [];
      list.push({
        gate_in_time: v.gate_in_time,
        gate_out_time: v.gate_out_time,
        port_arrival_date: v.port_arrival_date,
        free_days: v.free_days,
        yard_id: v.yard_id,
      });
      byNumber.set(number, list);
    }
  }
  return byNumber;
}

/** Existing port list rows for these containers, keyed by container number. */
export async function fetchPortRowsFor(
  containerNumbers: string[],
  yardId: string | null,
): Promise<Map<string, PortListEntry>> {
  const byNumber = new Map<string, PortListEntry>();
  for (const part of slices(Array.from(new Set(containerNumbers)))) {
    let q = supabase
      .from("container_port_data")
      .select("container_number, shipping_line, container_type, port_arrival_date, free_days, yard_id")
      .in("container_number", part);
    if (yardId) q = q.eq("yard_id", yardId);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) byNumber.set(r.container_number, r as PortListEntry);
  }
  return byNumber;
}

/** The whole port list for the yard (or every yard), with each container's status. */
export function usePortList(yardId: string | null) {
  return useQuery({
    queryKey: ["container_port_data", "status", yardId ?? "all"],
    queryFn: async (): Promise<PortListRow[]> => {
      const entries = await fetchAllRows<PortListEntry>((from, to) => {
        let q = supabase
          .from("container_port_data")
          .select("container_number, shipping_line, container_type, port_arrival_date, free_days, yard_id, last_source, updated_at")
          .order("port_arrival_date", { ascending: false })
          .order("container_number")
          .range(from, to);
        if (yardId) q = q.eq("yard_id", yardId);
        return q;
      });
      const visits = await fetchVisitsFor(entries.map((e) => e.container_number), yardId);
      return buildPortListRows(entries, visits);
    },
  });
}
