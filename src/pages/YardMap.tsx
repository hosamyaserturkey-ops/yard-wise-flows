import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Search } from "lucide-react";

interface Row {
  id: string;
  container_number: string;
  container_type: string;
  shipping_line: string;
  yard_block: string | null;
  yard_row: string | null;
  gate_in_time: string;
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

const YardMap = () => {
  const { currentYardId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const yardId = currentYardId();
      let q = supabase
        .from("containers")
        .select("id, container_number, container_type, shipping_line, yard_block, yard_row, gate_in_time")
        .in("status", ["in-yard", "reserved"]);
      if (yardId) q = q.eq("yard_id", yardId);
      const { data } = await q;
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [currentYardId]);

  const matchesSearch = (r: Row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.container_number.toLowerCase().includes(q);
  };

  const grid = useMemo(() => {
    // group by block → row → container list
    const byBlock = new Map<string, Map<string, Row[]>>();
    let unassigned: Row[] = [];
    rows.forEach((r) => {
      if (!r.yard_block) {
        unassigned.push(r);
        return;
      }
      const b = r.yard_block;
      const row = r.yard_row || "—";
      if (!byBlock.has(b)) byBlock.set(b, new Map());
      const rowMap = byBlock.get(b)!;
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(r);
    });
    return { byBlock, unassigned };
  }, [rows]);

  const highlightedIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set<string>();
    return new Set(rows.filter((r) => r.container_number.toLowerCase().includes(q)).map((r) => r.id));
  }, [rows, search]);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader icon={MapPin} title="Yard Map" subtitle="Block × Row layout of containers currently in the yard" />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-10"
          placeholder="Search container number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : grid.byBlock.size === 0 && grid.unassigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">No containers in yard.</p>
      ) : (
        <div className="space-y-6">
          {Array.from(grid.byBlock.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([block, rowMap]) => (
              <Card key={block}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Block {block}
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      {Array.from(rowMap.values()).reduce((s, l) => s + l.length, 0)} containers
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {Array.from(rowMap.entries())
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([row, list]) => (
                        <div
                          key={row}
                          className="border rounded-lg p-3 bg-muted/30 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Row {row}</span>
                            <Badge variant="secondary">{list.length}</Badge>
                          </div>
                          <ul className="space-y-1">
                            {list.map((r) => {
                              const highlighted = highlightedIds.has(r.id);
                              return (
                                <li
                                  key={r.id}
                                  className={`text-xs rounded px-2 py-1 border flex items-center justify-between ${
                                    highlighted ? "bg-warning/20 border-warning" : "bg-background"
                                  }`}
                                >
                                  <span className="font-mono truncate">{r.container_number}</span>
                                  <span className="text-muted-foreground ml-2 whitespace-nowrap">
                                    {r.shipping_line} · {r.container_type} · {daysSince(r.gate_in_time)}d
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            ))}

          {grid.unassigned.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-warning">
                  Unassigned
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    {grid.unassigned.length} containers — assign a block/row on gate-in
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {grid.unassigned.filter(matchesSearch).map((r) => (
                    <div
                      key={r.id}
                      className={`text-xs rounded px-2 py-1 border ${
                        highlightedIds.has(r.id) ? "bg-warning/20 border-warning" : "bg-background"
                      }`}
                    >
                      <span className="font-mono">{r.container_number}</span>
                      <span className="text-muted-foreground ml-2">
                        {r.shipping_line} · {r.container_type}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default YardMap;
