import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatJod } from "@/lib/accounting";
import { ReasonDialog } from "./ReasonDialog";
import { formatWeekdayDate } from "@/lib/format";

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
  original_counted_cash: number | null;
  recounted_at: string | null;
  recounted_by: string | null;
  recount_reason: string | null;
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
  const [recounting, setRecounting] = useState<CashCountRow | null>(null);
  const [recountAmount, setRecountAmount] = useState("");

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
    const ids = [...new Set(list.flatMap((r) => [r.counted_by, r.recounted_by]).filter((x): x is string => !!x))];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, username").in("user_id", ids);
      setNames(Object.fromEntries((profs ?? []).map((p) => [p.user_id, p.full_name || p.username || ""])));
    }
  }, [yardId, toast]);

  useEffect(() => { load(); }, [load]);

  const shortages = rows.filter((r) => Number(r.difference) < -TOLERANCE).length;

  const recountValue = Number(recountAmount);
  const recountValid = recountAmount.trim() !== "" && Number.isFinite(recountValue) && recountValue >= 0;

  const recount = async (reason: string) => {
    if (!recounting || !recountValid) {
      toast({ title: "Enter the cash counted", variant: "destructive" });
      throw new Error("invalid amount");
    }
    const { error } = await supabase.rpc("recount_cash", {
      _cash_count_id: recounting.id, _counted: recountValue, _reason: reason,
    });
    if (error) {
      toast({ title: "Recount not saved", description: error.message, variant: "destructive" });
      throw error;
    }
    toast({ title: "Recount recorded", description: `${formatJod(recountValue)} — expected cash was recalculated too.` });
    setRecounting(null);
    load();
  };

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
                <TableHead className="w-10"><span className="sr-only">Recount</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const diff = Number(r.difference ?? 0);
                const status = diff < -TOLERANCE ? "short" : diff > TOLERANCE ? "over" : "balanced";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatWeekdayDate(r.shift_date, false)}
                      {" · "}<span className="capitalize">{r.shift}</span>
                    </TableCell>
                    <TableCell className="text-sm">{names[r.counted_by] || "—"}</TableCell>
                    <TableCell className="text-right">{r.payment_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.expected_cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatJod(r.counted_cash)}
                      {r.recounted_at && (
                        <div className="text-xs text-muted-foreground" title={r.recount_reason ?? undefined}>
                          recounted{r.recounted_by && names[r.recounted_by] ? ` by ${names[r.recounted_by]}` : ""}
                          {r.original_counted_cash != null ? ` · first ${formatJod(r.original_counted_cash)}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {status === "balanced" ? (
                        <Badge className="bg-success/10 text-success border-success/30">Balanced</Badge>
                      ) : (
                        <Badge variant={status === "short" ? "destructive" : "outline"} className="tabular-nums">
                          {status === "short" ? "Short " : "Over +"}{formatJod(Math.abs(diff))}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-56 truncate" title={r.notes ?? undefined}>
                      {r.notes || ""}
                      {r.recount_reason && <div className="text-xs truncate">Recount: {r.recount_reason}</div>}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        title="Record a recount of this drawer"
                        onClick={() => { setRecountAmount(""); setRecounting(r); }}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ReasonDialog
        open={recounting !== null}
        title="Recount the drawer"
        description={recounting ? <>Replaces the {formatJod(recounting.counted_cash)} counted for this shift. The first count is kept on
          record, and the expected cash is recalculated so any payment voided since is taken into account.</> : ""}
        confirmLabel="Save recount"
        onCancel={() => setRecounting(null)}
        onConfirm={recount}
      >
        <div className="space-y-2">
          <Label htmlFor="recount-amount">Cash in drawer (JOD)</Label>
          <Input id="recount-amount" type="number" inputMode="decimal" min={0} step="0.001"
            value={recountAmount} onChange={(e) => setRecountAmount(e.target.value)} placeholder="0.000" />
        </div>
      </ReasonDialog>
    </Card>
  );
}
