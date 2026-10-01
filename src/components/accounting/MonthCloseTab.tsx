import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Lock, LockOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  buildLineStatement, formatJod, monthLabel, monthRange, recentMonths, sumJod,
  type AccountingPayment, type LineStatementRow, type StatementTransfer,
} from "@/lib/accounting";
import { buildStatementReport } from "@/lib/accountingReport";
import { ReasonDialog } from "./ReasonDialog";
import { formatDate, formatDateTime } from "@/lib/format";

interface MonthClose {
  id: string;
  month: string;
  closed_at: string;
  closed_by: string;
  notes: string | null;
  summary: {
    total_collected?: number;
    demurrage?: number;
    service_fees?: number;
    transferred?: number;
    voided?: number;
    payments?: number;
    lines?: LineStatementRow[];
  };
  reopened_at: string | null;
  reopen_reason: string | null;
}

interface MonthCloseTabProps {
  yardId: string | null;
  yardName: string;
  superAdmin: boolean;
  payments: (AccountingPayment & { container_number: string; created_at: string })[];
  transfers: StatementTransfer[];
  generatedBy?: string;
  /** Refresh the page's data after a close or reopen. */
  onChanged: () => void;
}

const errorText = (e: unknown) =>
  typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong.";

/**
 * Close a finished month: its figures are snapshotted and nothing dated in it
 * can change afterwards. Shows each line's statement for the month.
 */
export function MonthCloseTab({ yardId, yardName, superAdmin, payments, transfers, generatedBy, onChanged }: MonthCloseTabProps) {
  const { toast } = useToast();
  const months = useMemo(() => recentMonths(13), []);
  const [month, setMonth] = useState(months[1]);
  const [closes, setCloses] = useState<MonthClose[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState<MonthClose | null>(null);

  const load = useCallback(async () => {
    // Closes are per yard; with "all yards" selected there is no single one to show.
    if (!yardId) {
      setCloses([]);
      return;
    }
    const { data, error } = await supabase.from("accounting_month_closes").select("*")
      .eq("yard_id", yardId).order("closed_at", { ascending: false });
    if (error) {
      toast({ title: "Could not load month closes", description: error.message, variant: "destructive" });
      return;
    }
    setCloses((data ?? []) as unknown as MonthClose[]);
  }, [yardId, toast]);

  useEffect(() => { load(); }, [load]);

  const { start, end } = useMemo(() => monthRange(month), [month]);
  const ended = end.getTime() <= Date.now();
  const activeClose = closes.find((c) => c.month.slice(0, 7) === month && !c.reopened_at) ?? null;
  const history = closes.filter((c) => c.month.slice(0, 7) === month && c.reopened_at);

  // A closed month shows its snapshot; an open one is computed live.
  const liveRows = useMemo(
    () => buildLineStatement(payments, transfers, start, end),
    [payments, transfers, start, end],
  );
  const rows: LineStatementRow[] = activeClose?.summary.lines?.map((l) => ({
    shipping_line: l.shipping_line,
    opening: Number(l.opening), collected: Number(l.collected),
    transferred: Number(l.transferred), closing: Number(l.closing),
  })) ?? liveRows;

  const totals = {
    opening: sumJod(rows.map((r) => r.opening)),
    collected: sumJod(rows.map((r) => r.collected)),
    transferred: sumJod(rows.map((r) => r.transferred)),
    closing: sumJod(rows.map((r) => r.closing)),
  };

  const closeMonth = async () => {
    if (!yardId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("close_accounting_month", {
        _yard_id: yardId, _month: `${month}-01`, _notes: notes.trim() || null,
      });
      if (error) throw error;
      toast({ title: `${monthLabel(month)} closed`, description: "Nothing dated in it can be added or voided now." });
      setNotes("");
      await load();
      onChanged();
    } catch (e) {
      toast({ title: "Could not close the month", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (reason: string) => {
    if (!reopening) return;
    const { error } = await supabase.rpc("reopen_accounting_month", { _close_id: reopening.id, _reason: reason });
    if (error) {
      toast({ title: "Could not reopen", description: error.message, variant: "destructive" });
      throw error;
    }
    toast({ title: `${monthLabel(month)} reopened` });
    setReopening(null);
    await load();
    onChanged();
  };

  const exportStatement = async () => {
    const { downloadReport } = await import("@/lib/reports/workbook");
    await downloadReport(buildStatementReport({
      rows, monthLabel: monthLabel(month), yardName, generatedBy,
      status: activeClose ? `Closed ${formatDate(activeClose.closed_at)}` : "Open — figures can still change",
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Month Close & Line Statements</CardTitle>
          <CardDescription>
            What the yard held for each line during the month. Closing a finished month freezes these figures:
            no payment or transfer dated in it can be added or voided afterwards.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => {
                const closed = closes.some((c) => c.month.slice(0, 7) === m && !c.reopened_at);
                return <SelectItem key={m} value={m}>{monthLabel(m)}{closed ? " · closed" : ""}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportStatement}>
            <Download className="h-4 w-4 mr-1" /> Statement
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {activeClose ? (
            <>
              <Badge className="bg-success text-white"><Lock className="h-3 w-3 mr-1" />Closed</Badge>
              <span className="text-muted-foreground">
                on {formatDateTime(activeClose.closed_at)}
                {activeClose.notes ? ` — ${activeClose.notes}` : ""}. Figures below are the snapshot taken then.
              </span>
              {superAdmin && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReopening(activeClose)}>
                  <LockOpen className="h-4 w-4 mr-1" /> Reopen
                </Button>
              )}
            </>
          ) : (
            <>
              <Badge variant="outline">Open</Badge>
              <span className="text-muted-foreground">
                {ended ? "This month has ended and can be closed." : "This month hasn't ended yet — it can be closed from the 1st."}
              </span>
            </>
          )}
        </div>

        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nothing was held for any line in {monthLabel(month)}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">+ Collected</TableHead>
                  <TableHead className="text-right">− Transferred</TableHead>
                  <TableHead className="text-right">Closing (owed)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.shipping_line}>
                    <TableCell className="font-semibold">{r.shipping_line}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.opening)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.collected)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(r.transferred)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{formatJod(r.closing)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(totals.opening)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(totals.collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(totals.transferred)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(totals.closing)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>

        {activeClose && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Collected</div><div className="font-semibold">{formatJod(activeClose.summary.total_collected)}</div></div>
            <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Service fees</div><div className="font-semibold">{formatJod(activeClose.summary.service_fees)}</div></div>
            <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Payments</div><div className="font-semibold">{activeClose.summary.payments ?? 0}</div></div>
            <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Voided</div><div className="font-semibold">{activeClose.summary.voided ?? 0}</div></div>
          </div>
        )}

        {!activeClose && ended && yardId && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex-1 min-w-56 space-y-2">
              <Label htmlFor="close-notes">Notes (optional)</Label>
              <Textarea id="close-notes" rows={1} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Reconciled with bank statement" />
            </div>
            <Button onClick={closeMonth} disabled={busy}>
              <Lock className="h-4 w-4 mr-1" /> {busy ? "Closing…" : `Close ${monthLabel(month)}`}
            </Button>
          </div>
        )}
        {!yardId && <p className="text-sm text-muted-foreground">Pick a yard from the switcher to close a month.</p>}

        {history.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-1">
            {history.map((h) => (
              <div key={h.id}>
                Previously closed {formatDate(h.closed_at)}, reopened{" "}
                {h.reopened_at ? formatDate(h.reopened_at) : ""}: {h.reopen_reason}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ReasonDialog
        open={reopening !== null}
        destructive
        title={`Reopen ${monthLabel(month)}`}
        description="Reopening lets payments and transfers dated in this month be voided or added again. Close it again once the correction is made — a new snapshot is taken then."
        confirmLabel="Reopen"
        onCancel={() => setReopening(null)}
        onConfirm={reopen}
      />
    </Card>
  );
}
