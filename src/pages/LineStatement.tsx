import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/dashboard/StatCard";
import { Download, ExternalLink, Landmark, Clock, CheckCircle2, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { resolveSignedUrl } from "@/lib/storage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  buildLineStatement, buildShippingLineBreakdown, formatJod, monthLabel, monthRange, recentMonths, sumJod,
} from "@/lib/accounting";
import { buildStatementReport } from "@/lib/accountingReport";
import { formatDate } from "@/lib/format";

interface PaymentRow {
  id: string;
  container_number: string;
  shipping_line: string;
  demurrage_amount: number;
  service_fee: number;
  total_collected: number;
  created_at: string;
  transferred: boolean;
  voided_at: string | null;
}

interface TransferRow {
  id: string;
  shipping_line: string;
  amount_transferred: number;
  transferred_at: string;
  reference: string | null;
  payment_count: number | null;
  receipt_url: string | null;
  voided_at: string | null;
}

/**
 * A shipping line's own statement: what the yard holds for it now, what was
 * sent, month by month, and every transfer receipt. The database only returns
 * the rep's own line's rows, so nothing here filters by line.
 */
const LineStatement = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const line = profile?.shipping_line ?? "";
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        fetchAllRows<PaymentRow>((from, to) => supabase.from("demurrage_payments")
          .select("id, container_number, shipping_line, demurrage_amount, service_fee, total_collected, created_at, transferred, voided_at")
          .is("voided_at", null)
          .order("created_at", { ascending: false }).order("id").range(from, to)),
        fetchAllRows<TransferRow>((from, to) => supabase.from("shipping_line_transfers")
          .select("id, shipping_line, amount_transferred, transferred_at, reference, payment_count, receipt_url, voided_at")
          .is("voided_at", null)
          .order("transferred_at", { ascending: false }).order("id").range(from, to)),
      ]);
      setPayments(p);
      setTransfers(t);
    } catch (e) {
      toast({ title: "Could not load your statement", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const now = useMemo(() => new Date(), [payments]); // eslint-disable-line react-hooks/exhaustive-deps
  const [owed] = useMemo(() => buildShippingLineBreakdown(payments, [], now), [payments, now]);
  const pending = payments.filter((p) => !p.transferred);
  const thisMonth = monthRange(recentMonths(1)[0]);
  const transferredThisMonth = sumJod(
    transfers.filter((t) => new Date(t.transferred_at) >= thisMonth.start).map((t) => t.amount_transferred),
  );

  // One statement row per month, newest first — a single line, so one row each.
  const months = useMemo(() => recentMonths(12).map((m) => {
    const { start, end } = monthRange(m);
    const [row] = buildLineStatement(payments, transfers, start, end);
    return { month: m, row: row ?? { shipping_line: line, opening: 0, collected: 0, transferred: 0, closing: 0 } };
  }), [payments, transfers, line]);

  const openReceipt = async (path: string) => {
    const signed = await resolveSignedUrl("transfer-receipts", path);
    if (signed) window.open(signed, "_blank", "noopener,noreferrer");
    else toast({ title: "Receipt unavailable", variant: "destructive" });
  };

  const exportMonth = async (m: string) => {
    const { downloadReport } = await import("@/lib/reports/workbook");
    const { row } = months.find((x) => x.month === m)!;
    await downloadReport(buildStatementReport({
      rows: [row], monthLabel: monthLabel(m), shippingLine: line,
      status: "As recorded by the yard",
      generatedBy: profile?.full_name?.trim() || profile?.username?.trim() || undefined,
    }));
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Landmark}
        title="Statement"
        subtitle={`Demurrage the yard collected for ${line || "your line"}, and what has been transferred to you`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Held for you now" value={formatJod(owed?.totalOwed ?? 0)} color="warning"
          icon={<Clock className="h-5 w-5 text-warning" />} loading={loading} />
        <StatCard label="Awaiting transfer" value={`${pending.length} payment${pending.length !== 1 ? "s" : ""}`} color="maritime"
          icon={<CalendarClock className="h-5 w-5 text-maritime" />} loading={loading} />
        <StatCard label="Transferred this month" value={formatJod(transferredThisMonth)} color="success"
          icon={<CheckCircle2 className="h-5 w-5 text-success" />} loading={loading} />
        <StatCard label="Oldest pending"
          value={owed?.oldestPendingAt ? formatDate(owed.oldestPendingAt) : "—"}
          color="container" icon={<CalendarClock className="h-5 w-5 text-container" />} loading={loading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Statement</CardTitle>
          <CardDescription>Opening balance + demurrage collected − transferred = closing balance held by the yard.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">+ Collected</TableHead>
                <TableHead className="text-right">− Transferred</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                <TableHead className="w-10"><span className="sr-only">Export</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map(({ month, row }) => (
                <TableRow key={month}>
                  <TableCell className="whitespace-nowrap">{monthLabel(month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(row.opening)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(row.collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatJod(row.transferred)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatJod(row.closing)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Download this month's statement" onClick={() => exportMonth(month)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transfers to You</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {transfers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No transfers recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(t.transferred_at)}</TableCell>
                    <TableCell className="text-sm">{t.reference || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">{t.payment_count ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{formatJod(t.amount_transferred)}</TableCell>
                    <TableCell>
                      {t.receipt_url ? (
                        <button type="button" onClick={() => openReceipt(t.receipt_url!)}
                          className="text-primary hover:underline flex items-center gap-1 text-sm">
                          <ExternalLink className="h-3 w-3" /> View
                        </button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting Transfer</CardTitle>
          <CardDescription>Demurrage collected for you that hasn't been transferred yet.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nothing pending — everything collected has been transferred.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead className="text-right">Demurrage</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => {
                  const days = Math.floor((now.getTime() - new Date(p.created_at).getTime()) / 86_400_000);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.container_number}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatDate(p.created_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatJod(p.demurrage_amount)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={days > 30 ? "destructive" : "outline"}>{days} d</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LineStatement;
