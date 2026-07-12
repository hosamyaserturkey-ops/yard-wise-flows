import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Sun, Moon } from "lucide-react";
import type { WorkShift } from "@/lib/shifts";
import type { ActivityAction } from "@/lib/activityLog";

interface Row {
  id: string;
  action: ActivityAction;
  container_number: string | null;
  shift: WorkShift;
  occurred_at: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
}

interface Operator {
  user_id: string;
  full_name: string | null;
  username: string | null;
}

const ACTION_LABEL: Record<ActivityAction, string> = {
  gate_in: "Gate In",
  gate_out: "Gate Out",
  reserve: "Reserve",
  unreserve: "Unreserve",
  demurrage_collected: "Demurrage",
};

const ACTION_VARIANT: Record<ActivityAction, "default" | "secondary" | "outline" | "destructive"> = {
  gate_in: "default",
  gate_out: "secondary",
  reserve: "outline",
  unreserve: "outline",
  demurrage_collected: "destructive",
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const ActivityLog = () => {
  const { currentYardId, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [operators, setOperators] = useState<Record<string, Operator>>({});
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState(todayISO(-6));
  const [to, setTo] = useState(todayISO(0));
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const fromTs = new Date(`${from}T00:00:00`).toISOString();
      const toTs = new Date(`${to}T23:59:59.999`).toISOString();

      let q = supabase
        .from("activity_log")
        .select("id, action, container_number, shift, occurred_at, user_id, metadata")
        .gte("occurred_at", fromTs)
        .lte("occurred_at", toTs)
        .order("occurred_at", { ascending: false })
        .limit(1000);

      const yardId = currentYardId();
      if (!isSuperAdmin() && yardId) q = q.eq("yard_id", yardId);

      const { data, error } = await q;
      if (error) throw error;
      const list = (data ?? []) as unknown as Row[];
      setRows(list);

      // Load profiles for operator names
      const ids = Array.from(new Set(list.map((r) => r.user_id)));
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name, username")
          .in("user_id", ids);
        const map: Record<string, Operator> = {};
        (profs ?? []).forEach((p) => { map[p.user_id] = p as Operator; });
        setOperators(map);
      } else {
        setOperators({});
      }
    } finally {
      setLoading(false);
    }
  }, [from, to, currentYardId, isSuperAdmin]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (operatorFilter !== "all" && r.user_id !== operatorFilter) return false;
      if (shiftFilter !== "all" && r.shift !== shiftFilter) return false;
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      return true;
    });
  }, [rows, operatorFilter, shiftFilter, actionFilter]);

  const byOperator = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => map.set(r.user_id, (map.get(r.user_id) ?? 0) + 1));
    return Array.from(map.entries())
      .map(([uid, count]) => ({
        uid,
        name: operators[uid]?.full_name || operators[uid]?.username || uid.slice(0, 8),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered, operators]);

  const byShift = useMemo(() => {
    const day = filtered.filter((r) => r.shift === "day").length;
    const night = filtered.filter((r) => r.shift === "night").length;
    return { day, night };
  }, [filtered]);

  const operatorOptions = useMemo(() => {
    return Object.values(operators).sort((a, b) =>
      (a.full_name || a.username || "").localeCompare(b.full_name || b.username || ""),
    );
  }, [operators]);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader icon={Activity} title="Activity Log" subtitle="Shift-aware audit trail of gate operations" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Operator</Label>
              <Select value={operatorFilter} onValueChange={setOperatorFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All operators</SelectItem>
                  {operatorOptions.map((o) => (
                    <SelectItem key={o.user_id} value={o.user_id}>
                      {o.full_name || o.username || o.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Shift</Label>
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shifts</SelectItem>
                  <SelectItem value="day">Day (06–18)</SelectItem>
                  <SelectItem value="night">Night (18–06)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {(Object.keys(ACTION_LABEL) as ActivityAction[]).map((a) => (
                    <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total moves</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{filtered.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Sun className="h-4 w-4 text-warning" /> Day shift</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{byShift.day}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Moon className="h-4 w-4 text-maritime" /> Night shift</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{byShift.night}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Moves per operator</CardTitle></CardHeader>
          <CardContent>
            {byOperator.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity in range.</p>
            ) : (
              <ul className="space-y-2">
                {byOperator.map((o) => (
                  <li key={o.uid} className="flex items-center justify-between text-sm">
                    <span className="truncate">{o.name}</span>
                    <Badge variant="secondary">{o.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Events</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events match the current filters.</p>
            ) : (
              <div className="max-h-[600px] overflow-y-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left px-2 py-2">Time</th>
                      <th className="text-left px-2 py-2">Operator</th>
                      <th className="text-left px-2 py-2">Shift</th>
                      <th className="text-left px-2 py-2">Action</th>
                      <th className="text-left px-2 py-2">Container</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const d = new Date(r.occurred_at);
                      const op = operators[r.user_id];
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {d.toLocaleDateString("en-GB")} {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-2 py-1.5">{op?.full_name || op?.username || r.user_id.slice(0, 8)}</td>
                          <td className="px-2 py-1.5">
                            {r.shift === "day" ? <Sun className="h-4 w-4 text-warning" /> : <Moon className="h-4 w-4 text-maritime" />}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge variant={ACTION_VARIANT[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs">{r.container_number ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ActivityLog;
