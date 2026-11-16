import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cachedFor, type CachedYards } from "@/lib/yardCache";

export interface YardOption {
  id: string;
  name: string;
  /** 'container' or 'vehicle' (a car lot). */
  kind: string;
}

// Remembered per signed-in user (see lib/yardCache.ts): never reused for a
// different user, never filled before anyone is signed in.
let cache: CachedYards<YardOption> | null = null;
const listeners = new Set<(userId: string, yards: YardOption[]) => void>();
const loading = new Set<string>();

async function loadYards(userId: string) {
  if (loading.has(userId)) return;
  loading.add(userId);
  try {
    const { data, error } = await supabase.from("yards").select("id, name, kind").order("name");
    if (error) return; // a failure is not remembered, so the next screen tries again
    cache = { userId, yards: (data ?? []) as YardOption[] };
    listeners.forEach((l) => l(userId, cache!.yards));
  } finally {
    loading.delete(userId);
  }
}

export function useYards() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [yards, setYards] = useState<YardOption[]>(() => cachedFor(cache, userId) ?? []);

  useEffect(() => {
    if (!userId) {
      setYards([]);
      return;
    }
    const known = cachedFor(cache, userId);
    if (known) setYards(known);
    else {
      setYards([]);
      void loadYards(userId);
    }
    const onLoaded = (loadedFor: string, list: YardOption[]) => {
      if (loadedFor === userId) setYards(list);
    };
    listeners.add(onLoaded);
    return () => { listeners.delete(onLoaded); };
  }, [userId]);

  const nameOf = (id: string | null | undefined) =>
    id ? yards.find((y) => y.id === id)?.name ?? "—" : "—";
  return { yards, nameOf };
}
