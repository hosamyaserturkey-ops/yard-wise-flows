import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatJod } from "@/lib/accounting";

interface CashCountRow {
  id: string;
  shift_date: string;
  shift: "day" | "night";
  counted_cash: number;
  expected_cash: number;
  difference: number | null;
  payment_count: number;
  counted_by: string;
  notes: string | null;
  created_at: string;
}

/** Anything off by a fils or more is shown as short or over. */
const TOLERANCE = 0.0005;

/**
 * Each shift's blind drawer count against the cash the system recorded for
 * that shift. The cashier never sees the expected figure when counting.
 */
export function CashCountsTab({ yardId }: { yardId: string | null }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<CashCountRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    let q = supabase.from("cash_counts").select("*")
      .order("shift_date", { ascending: false }).order("shift", { ascending: false }).limit(200);
    if (yardId) q = q.eq("yard_id", yardId);
    const { data, error } = await q;
    if (error) {
      toast({ title: "Could not load cash counts", description: error.message, variant: "destructive" });
      return;
    }
    const list = (data ?? []) as CashCountRow[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.counted_by))];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, username").in("user_id", ids);
      setNames(Object.fromEntries((profs ?? []).map((p) => [p.user_id, p.full_name || p.username || ""])));
    }
  }, [yardId, toast]);

  useEffect(() => { load(); }, [load]);

  const shortages = rows.filter((r) => Number(r.difference) < -TOLERANCE).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash Drawer Counts</CardTitle>
        <CardDescription>
          At the end of each shift the cashier counts the drawer on the Cash Count page without seeing the expected
          figure. Expected = cash payments recorded in that shift, voids excluded.
          {shortages > 0 && <span className="text-destructive font-medium"> {shortages} shift{shortages !== 1 ? "s" : ""} short.</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No drawer counts recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead>
                <TableHead>Counted by</TableHead>
                <TableHead className="text-right">Cash payments</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const diff = Number(r.difference ?? 0);
                const status = diff < -TOLERANCE ? "short" : diff > TOLERANCE ? "over" : "balanced";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(`${r.shift_date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                      {" · "}<span className="capitalize">{r.shift}</span>
                    </TableCell>
                    <TableCell className="text-sm">{names[r.counted_by] || "—"}</TableCell>
                    <TableCell className="text-right">{r.payment_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.expected_cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.counted_cash)}</TableCell>
                    <TableCell className="text-right">
                      {status === "balanced" ? (
                        <Badge className="bg-success/10 text-success border-success/30">Balanced</Badge>
                      ) : (
                        <Badge variant={status === "short" ? "destructive" : "outline"} className="tabular-nums">
                          {status === "short" ? "Short " : "Over +"}{formatJod(Math.abs(diff))}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-56 truncate" title={r.notes ?? undefined}>{r.notes || ""}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
