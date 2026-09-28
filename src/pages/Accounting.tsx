import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/dashboard/StatCard";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYards } from "@/hooks/useYards";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2, Upload, ExternalLink, Calculator, Download, Search, Ban, Pencil,
} from "lucide-react";
import { ReasonDialog } from "@/components/accounting/ReasonDialog";
import { MonthCloseTab } from "@/components/accounting/MonthCloseTab";
import { CashCountsTab } from "@/components/accounting/CashCountsTab";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { PageHeader } from "@/components/PageHeader";
import { resolveSignedUrl } from "@/lib/storage";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis } from "recharts";
import {
  buildDailyClose, buildShippingLineBreakdown, formatJod, localDateKey, summarizePayments, sumJod, yardEarned,
  type ShippingLineOwed,
} from "@/lib/accounting";
import { buildAccountingReport } from "@/lib/accountingReport";

interface PaymentRow {
  id: string;
  container_number: string;
  shipping_line: string;
  demurrage_amount: number;
  service_fee: number;
  total_collected: number;
  payment_method: string;
  collected_by: string;
  created_at: string;
  transferred: boolean;
  transfer_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

interface TransferRow {
  id: string;
  shipping_line: string;
  amount_transferred: number;
  receipt_url: string | null;
  transferred_at: string;
  reference: string | null;
  notes: string | null;
  payment_count: number | null;
  voided_at: string | null;
  void_reason: string | null;
}

type CorrectionAction =
  | { kind: "voidPayment"; payment: PaymentRow }
  | { kind: "voidTransfer"; transfer: TransferRow }
  | { kind: "editTransfer"; transfer: TransferRow };

const ALL_LINES = "__all__";

const METHOD_LABEL: Record<string, string> = { cash: "Cash", qlick: "Qlick" };
const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

const chartConfig: ChartConfig = {
  collected: { label: "Collected (JOD)", color: "hsl(var(--chart-1))" },
  yard: { label: "Service Fees (JOD)", color: "hsl(var(--chart-3))" },
};


const daysSince = (iso: string | null, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)) : 0;

const fmtDay = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

const Accounting = () => {
  const { user, profile, currentYardId, isSuperAdmin } = useAuth();
  const { nameOf: yardName } = useYards();
  const { toast } = useToast();
  const yardId = currentYardId();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lineFilter, setLineFilter] = useState(ALL_LINES);
  const [search, setSearch] = useState("");
  const [settleRow, setSettleRow] = useState<ShippingLineOwed | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [correction, setCorrection] = useState<CorrectionAction | null>(null);
  const [editRef, setEditRef] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        fetchAllRows<PaymentRow>((from, to) => {
          let q = supabase.from("demurrage_payments").select("*");
          if (yardId) q = q.eq("yard_id", yardId);
          return q.order("created_at", { ascending: false }).order("id").range(from, to);
        }),
        fetchAllRows<TransferRow>((from, to) => {
          let q = supabase.from("shipping_line_transfers").select("*");
          if (yardId) q = q.eq("yard_id", yardId);
          return q.order("transferred_at", { ascending: false }).order("id").range(from, to);
        }),
      ]);
      setPayments(p);
      setTransfers(t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load accounting data.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [yardId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inRange = useCallback((iso: string) => {
    const d = new Date(iso);
    if (dateFrom && d < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && d > new Date(`${dateTo}T23:59:59.999`)) return false;
    return true;
  }, [dateFrom, dateTo]);

  const lines = useMemo(
    () => [...new Set([...payments.map((p) => p.shipping_line), ...transfers.map((t) => t.shipping_line)])].sort(),
    [payments, transfers],
  );

  const filteredPayments = useMemo(
    () => payments.filter((p) => inRange(p.created_at) && (lineFilter === ALL_LINES || p.shipping_line === lineFilter)),
    [payments, inRange, lineFilter],
  );

  const filteredTransfers = useMemo(
    () => transfers.filter((t) => inRange(t.transferred_at) && (lineFilter === ALL_LINES || t.shipping_line === lineFilter)),
    [transfers, inRange, lineFilter],
  );

  // A voided transfer's money came back into "owed"; it counts nowhere.
  const activeTransfers = useMemo(() => filteredTransfers.filter((t) => !t.voided_at), [filteredTransfers]);

  const summaryCards = useMemo(() => ({
    ...summarizePayments(filteredPayments),
    completedTransfers: sumJod(activeTransfers.map((t) => t.amount_transferred)),
  }), [filteredPayments, activeTransfers]);

  const now = useMemo(() => new Date(), [payments]); // eslint-disable-line react-hooks/exhaustive-deps

  const shippingLineBreakdown = useMemo<ShippingLineOwed[]>(
    () => buildShippingLineBreakdown(filteredPayments, new Set(activeTransfers.map((t) => t.shipping_line)), now)
      .sort((a, b) => b.totalOwed - a.totalOwed || a.shipping_line.localeCompare(b.shipping_line)),
    [filteredPayments, activeTransfers, now],
  );

  const dailyClose = useMemo(() => buildDailyClose(filteredPayments), [filteredPayments]);
  const methods = useMemo(
    () => [...new Set(dailyClose.flatMap((d) => Object.keys(d.byMethod)))].sort(),
    [dailyClose],
  );

  const visiblePayments = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? filteredPayments.filter((p) => p.container_number.toUpperCase().includes(q)) : filteredPayments;
  }, [filteredPayments, search]);

  // Monthly chart data — last 6 months, same line filter.
  const monthlyData = useMemo(() => {
    const scoped = payments.filter((p) => !p.voided_at && (lineFilter === ALL_LINES || p.shipping_line === lineFilter));
    const months: { month: string; collected: number; yard: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      const monthPayments = scoped.filter((p) => {
        const pd = new Date(p.created_at);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      });
      months.push({
        month: key,
        collected: sumJod(monthPayments.map((p) => p.total_collected)),
        yard: sumJod(monthPayments.map(yardEarned)),
      });
    }
    return months;
  }, [payments, lineFilter]);

  const closeSettle = () => {
    setSettleRow(null);
    setReceiptFile(null);
    setReference("");
    setNotes("");
  };

  const handleSettle = async () => {
    if (!settleRow || !receiptFile || !user) return;
    if (!yardId) {
      toast({ title: "Pick a yard", description: "Choose a yard from the switcher to record a transfer.", variant: "destructive" });
      return;
    }
    setIsTransferring(true);
    const fileExt = receiptFile.name.split(".").pop();
    const filePath = `${settleRow.shipping_line}/${Date.now()}.${fileExt}`;
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage.from("transfer-receipts").upload(filePath, receiptFile);
      if (uploadError) throw uploadError;
      uploaded = true;
      // One transaction server-side: it checks the payments are still pending,
      // computes the amount from them, records the transfer and links them.
      const { data, error } = await supabase.rpc("record_shipping_line_transfer", {
        _yard_id: yardId,
        _shipping_line: settleRow.shipping_line,
        _payment_ids: settleRow.paymentIds,
        _receipt_path: filePath,
        _reference: reference.trim() || null,
        _notes: notes.trim() || null,
      });
      if (error) throw error;
      const result = (data ?? {}) as { amount?: number; payment_count?: number };
      toast({
        title: "Transfer Recorded",
        description: `${formatJod(result.amount ?? settleRow.totalOwed)} for ${result.payment_count ?? settleRow.count} payment(s) transferred to ${settleRow.shipping_line}.`,
      });
      closeSettle();
      fetchData();
    } catch (error: unknown) {
      if (uploaded) {
        // Best effort: don't leave an orphaned receipt behind.
        await supabase.storage.from("transfer-receipts").remove([filePath]).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message
        : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message)
        : "Failed to record transfer.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsTransferring(false);
    }
  };

  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message
      : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message)
      : fallback;

  const openCorrection = (action: CorrectionAction) => {
    if (action.kind === "editTransfer") {
      setEditRef(action.transfer.reference ?? "");
      setEditNotes(action.transfer.notes ?? "");
    }
    setCorrection(action);
  };

  const runCorrection = async (reason: string) => {
    if (!correction) return;
    try {
      if (correction.kind === "voidPayment") {
        const { error } = await supabase.rpc("void_demurrage_payment", { _payment_id: correction.payment.id, _reason: reason });
        if (error) throw error;
        toast({ title: "Payment voided", description: `${correction.payment.container_number} — ${formatJod(correction.payment.total_collected)} no longer counts anywhere.` });
      } else if (correction.kind === "voidTransfer") {
        const { error } = await supabase.rpc("void_shipping_line_transfer", { _transfer_id: correction.transfer.id, _reason: reason });
        if (error) throw error;
        toast({ title: "Transfer voided", description: `Its payments are pending again for ${correction.transfer.shipping_line}.` });
      } else {
        const { error } = await supabase.rpc("edit_shipping_line_transfer", {
          _transfer_id: correction.transfer.id,
          _reference: editRef.trim() || null,
          _notes: editNotes.trim() || null,
          _reason: reason,
        });
        if (error) throw error;
        toast({ title: "Transfer updated" });
      }
      setCorrection(null);
      fetchData();
    } catch (error: unknown) {
      toast({ title: "Error", description: errorMessage(error, "The change was not saved."), variant: "destructive" });
      throw error;
    }
  };

  const openReceipt = async (path: string) => {
    const signed = await resolveSignedUrl("transfer-receipts", path);
    if (signed) window.open(signed, "_blank", "noopener,noreferrer");
    else toast({ title: "Receipt unavailable", description: "Could not open this receipt.", variant: "destructive" });
  };

  const periodLabel = () => {
    const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const range = dateFrom || dateTo ? `${dateFrom ? f(dateFrom) : "Start"} – ${dateTo ? f(dateTo) : "Today"}` : "All dates";
    return lineFilter === ALL_LINES ? range : `${range} · ${lineFilter}`;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { downloadReport } = await import("@/lib/reports/workbook");
      await downloadReport(buildAccountingReport({
        payments: filteredPayments,
        transfers: filteredTransfers,
        periodLabel: periodLabel(),
        yardName: yardId ? yardName(yardId) : "All yards",
        generatedBy: profile?.full_name?.trim() || profile?.username?.trim() || undefined,
      }));
    } catch (error) {
      console.error("Accounting export failed:", error);
      toast({ title: "Export failed", description: "Could not build the Excel file.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const filtered = dateFrom || dateTo || lineFilter !== ALL_LINES;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Calculator}
        title="Accounting"
        subtitle="Demurrage collections, what each shipping line is owed, and settlements"
        action={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || exporting}>
            <Download className="h-4 w-4 mr-1" /> {exporting ? "Exporting…" : "Export Excel"}
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" className="h-8 text-sm w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" className="h-8 text-sm w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Shipping line</Label>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LINES}>All lines</SelectItem>
                  {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setLineFilter(ALL_LINES); }}>
                Clear
              </Button>
            )}
            <span className="text-sm text-muted-foreground ml-auto">
              {filteredPayments.length} payment{filteredPayments.length !== 1 ? "s" : ""} shown
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Collected"
          value={formatJod(summaryCards.totalCollected)}
          color="maritime"
          icon={<DollarSign className="h-5 w-5 text-maritime" />}
          loading={loading}
        />
        <StatCard
          label="Yard Earnings (Fees)"
          value={formatJod(summaryCards.yardEarnings)}
          color="success"
          icon={<TrendingUp className="h-5 w-5 text-success" />}
          loading={loading}
        />
        <StatCard
          label="Owed to Lines"
          value={formatJod(summaryCards.pendingTransfers)}
          color="warning"
          icon={<Clock className="h-5 w-5 text-warning" />}
          loading={loading}
        />
        <StatCard
          label="Transferred"
          value={formatJod(summaryCards.completedTransfers)}
          color="container"
          icon={<CheckCircle2 className="h-5 w-5 text-container" />}
          loading={loading}
        />
      </div>

      {/* Monthly Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Collections — Last 6 Months</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-48 w-full">
              <BarChart data={monthlyData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="collected" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Total Collected" />
                <Bar dataKey="yard" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} name="Service Fees" />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="balances" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="balances">Line Balances</TabsTrigger>
          <TabsTrigger value="daily">Daily Close</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="month">Month Close</TabsTrigger>
          <TabsTrigger value="cash">Cash Counts</TabsTrigger>
        </TabsList>

        {/* Line balances with aging */}
        <TabsContent value="balances">
          <Card>
            <CardHeader>
              <CardTitle>Owed to Shipping Lines</CardTitle>
              <CardDescription>
                Demurrage held for each line, aged from the day it was collected. Settling a row
                covers exactly the payments counted in it.
                {!yardId && " Pick a yard from the switcher to record transfers."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {shippingLineBreakdown.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No shipping line data yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shipping Line</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">0–7 days</TableHead>
                      <TableHead className="text-right">8–30 days</TableHead>
                      <TableHead className="text-right">31–60 days</TableHead>
                      <TableHead className="text-right">61+ days</TableHead>
                      <TableHead className="text-right">Total Owed</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shippingLineBreakdown.map((row) => {
                      const age = daysSince(row.oldestPendingAt, now);
                      const lastTransfer = transfers.find((t) => t.shipping_line === row.shipping_line && !t.voided_at);
                      return (
                        <TableRow key={row.shipping_line}>
                          <TableCell className="font-semibold">
                            {row.shipping_line}
                            {row.totalOwed > 0 && (
                              <div className={`text-xs font-normal ${age > 30 ? "text-destructive" : "text-muted-foreground"}`}>
                                oldest {age} day{age !== 1 ? "s" : ""}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{row.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatJod(row.aging.days0to7)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatJod(row.aging.days8to30)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${row.aging.days31to60 > 0 ? "text-warning" : ""}`}>{formatJod(row.aging.days31to60)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${row.aging.days61plus > 0 ? "text-destructive font-semibold" : ""}`}>{formatJod(row.aging.days61plus)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatJod(row.totalOwed)}</TableCell>
                          <TableCell>
                            {row.totalOwed > 0 ? (
                              <Button
                                size="sm"
                                className="bg-success hover:bg-success/90 text-white"
                                disabled={!yardId}
                                onClick={() => setSettleRow(row)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Record Transfer
                              </Button>
                            ) : lastTransfer?.receipt_url ? (
                              <button
                                type="button"
                                onClick={() => openReceipt(lastTransfer.receipt_url!)}
                                className="text-primary hover:underline flex items-center gap-1 text-sm"
                              >
                                <ExternalLink className="h-3 w-3" /> Last Receipt
                              </button>
                            ) : (
                              <Badge className="bg-success text-white">Settled</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily close */}
        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <CardTitle>Daily Close</CardTitle>
              <CardDescription>What the counter took each day, by payment method — count the drawer against the cash column.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {dailyClose.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No payments in selected range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      {methods.map((m) => <TableHead key={m} className="text-right">{methodLabel(m)}</TableHead>)}
                      <TableHead className="text-right">Demurrage</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyClose.map((d) => (
                      <TableRow key={d.date} className={d.date === localDateKey(now.toISOString()) ? "bg-muted/40" : undefined}>
                        <TableCell className="whitespace-nowrap">{fmtDay(d.date)}</TableCell>
                        <TableCell className="text-right">{d.count}</TableCell>
                        {methods.map((m) => (
                          <TableCell key={m} className="text-right tabular-nums">{formatJod(d.byMethod[m] ?? 0)}</TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">{formatJod(d.demurrage)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatJod(d.fees)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{formatJod(d.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* All payments */}
        <TabsContent value="payments">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>Payments {filtered ? "(filtered)" : ""}</CardTitle>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input className="h-8 pl-8 text-sm" placeholder="Container number" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {visiblePayments.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No payments in selected range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Demurrage</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePayments.map((p) => {
                      const voided = !!p.voided_at;
                      return (
                        <TableRow key={p.id} className={voided ? "text-muted-foreground" : undefined}>
                          <TableCell className="font-mono text-sm">{p.container_number}</TableCell>
                          <TableCell><Badge variant="outline">{p.shipping_line}</Badge></TableCell>
                          <TableCell className={`text-right tabular-nums ${voided ? "line-through" : ""}`}>{formatJod(p.demurrage_amount)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${voided ? "line-through" : ""}`}>{formatJod(p.service_fee)}</TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${voided ? "line-through" : ""}`}>{formatJod(p.total_collected)}</TableCell>
                          <TableCell><Badge variant={p.payment_method === "cash" ? "secondary" : "default"}>{methodLabel(p.payment_method)}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{new Date(p.created_at).toLocaleDateString("en-GB")}</TableCell>
                          <TableCell>
                            {voided
                              ? <Badge variant="destructive" title={p.void_reason ?? undefined}>Voided</Badge>
                              : p.transferred
                                ? <Badge className="bg-success/10 text-success border-success/30">Transferred</Badge>
                                : <Badge variant="outline" className="text-warning border-warning/30">Pending</Badge>}
                            {voided && p.void_reason && <div className="text-xs mt-1 max-w-48 truncate" title={p.void_reason}>{p.void_reason}</div>}
                          </TableCell>
                          <TableCell>
                            {!voided && !p.transferred && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                title="Void / refund this payment"
                                onClick={() => openCorrection({ kind: "voidPayment", payment: p })}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transfer history */}
        <TabsContent value="transfers">
          <Card>
            <CardHeader>
              <CardTitle>Transfer History</CardTitle>
              <CardDescription>Every settlement with a shipping line, with its receipt.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filteredTransfers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No transfers in selected range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransfers.map((t) => (
                      <TableRow key={t.id} className={t.voided_at ? "text-muted-foreground" : undefined}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(t.transferred_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                          {t.voided_at && (
                            <div className="mt-1">
                              <Badge variant="destructive" title={t.void_reason ?? undefined}>Voided</Badge>
                            </div>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline">{t.shipping_line}</Badge></TableCell>
                        <TableCell className="text-sm">
                          {t.reference || <span className="text-muted-foreground">—</span>}
                          {t.notes && <div className="text-xs text-muted-foreground">{t.notes}</div>}
                          {t.voided_at && t.void_reason && <div className="text-xs text-destructive">Voided: {t.void_reason}</div>}
                        </TableCell>
                        <TableCell className="text-right">{t.payment_count ?? "—"}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${t.voided_at ? "line-through" : ""}`}>{formatJod(t.amount_transferred)}</TableCell>
                        <TableCell>
                          {t.receipt_url ? (
                            <button
                              type="button"
                              onClick={() => openReceipt(t.receipt_url!)}
                              className="text-primary hover:underline flex items-center gap-1 text-sm"
                            >
                              <ExternalLink className="h-3 w-3" /> View
                            </button>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell>
                          {!t.voided_at && (
                            <div className="flex gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="Correct the reference or notes"
                                onClick={() => openCorrection({ kind: "editTransfer", transfer: t })}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                                title="Void this transfer — its payments go back to pending"
                                onClick={() => openCorrection({ kind: "voidTransfer", transfer: t })}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Month close and per-line statements use all data, not the filters above. */}
        <TabsContent value="month">
          <MonthCloseTab
            yardId={yardId}
            yardName={yardId ? yardName(yardId) : "All yards"}
            superAdmin={isSuperAdmin()}
            payments={payments}
            transfers={transfers}
            generatedBy={profile?.full_name?.trim() || profile?.username?.trim() || undefined}
            onChanged={fetchData}
          />
        </TabsContent>

        <TabsContent value="cash">
          <CashCountsTab yardId={yardId} />
        </TabsContent>
      </Tabs>

      {/* Corrections — each needs a reason and is logged */}
      <ReasonDialog
        open={correction !== null}
        destructive={correction?.kind !== "editTransfer"}
        title={
          correction?.kind === "voidPayment" ? `Void payment for ${correction.payment.container_number}`
          : correction?.kind === "voidTransfer" ? `Void transfer to ${correction.transfer.shipping_line}`
          : "Correct transfer details"
        }
        description={
          correction?.kind === "voidPayment"
            ? <>Use this when the money was handed back or the payment was recorded by mistake. {formatJod(correction.payment.total_collected)} will
                stop counting in every total, and the container's demurrage will show as unpaid again at the gate.</>
          : correction?.kind === "voidTransfer"
            ? <>Use this when the transfer didn't happen or was recorded wrongly. Its {correction.transfer.payment_count ?? ""} payment(s),
                {" "}{formatJod(correction.transfer.amount_transferred)}, go back to pending so they can be settled again. The record is kept, marked voided.</>
          : <>The amount can't change here — it comes from the payments. To fix an amount, void the transfer and record it again.</>
        }
        confirmLabel={correction?.kind === "editTransfer" ? "Save" : "Void"}
        onCancel={() => setCorrection(null)}
        onConfirm={runCorrection}
      >
        {correction?.kind === "editTransfer" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="edit-reference">Bank / cheque reference</Label>
              <Input id="edit-reference" value={editRef} maxLength={100} onChange={(e) => setEditRef(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea id="edit-notes" value={editNotes} maxLength={500} rows={2} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
          </>
        )}
      </ReasonDialog>

      {/* Settle Dialog */}
      <Dialog open={settleRow !== null} onOpenChange={(o) => !o && !isTransferring && closeSettle()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Transfer to {settleRow?.shipping_line}</DialogTitle>
            <DialogDescription>
              Settles the {settleRow?.count} pending payment{settleRow?.count !== 1 ? "s" : ""} shown
              {filtered ? " under the current filters" : ""}. The amount is computed from those payments
              when the transfer is saved.
            </DialogDescription>
          </DialogHeader>
          {settleRow && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Shipping Line</span><span className="font-semibold">{settleRow.shipping_line}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payments</span><span className="font-semibold">{settleRow.count}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-bold text-lg">{formatJod(settleRow.totalOwed)}</span></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference">Bank / cheque reference</Label>
                <Input id="reference" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TRX-2026-0915" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt">Receipt (Image or PDF) *</Label>
                <Input id="receipt" type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={isTransferring} onClick={closeSettle}>Cancel</Button>
            <Button className="bg-success hover:bg-success/90 text-white" disabled={!receiptFile || isTransferring} onClick={handleSettle}>
              {isTransferring ? "Processing…" : <><Upload className="h-4 w-4 mr-1" />Confirm Transfer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Accounting;
