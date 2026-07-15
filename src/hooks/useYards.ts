import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface YardOption {
  id: string;
  name: string;
}

let cache: YardOption[] | null = null;
const listeners = new Set<(y: YardOption[]) => void>();

async function loadYards() {
  const { data } = await supabase.from("yards").select("id, name").order("name");
  cache = (data ?? []) as YardOption[];
  listeners.forEach((l) => l(cache!));
}

export function useYards() {
  const [yards, setYards] = useState<YardOption[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setYards);
    if (!cache) loadYards();
    else setYards(cache);
    return () => { listeners.delete(setYards); };
  }, []);
  const nameOf = (id: string | null | undefined) =>
    id ? yards.find((y) => y.id === id)?.name ?? "—" : "—";
  return { yards, nameOf };
}
