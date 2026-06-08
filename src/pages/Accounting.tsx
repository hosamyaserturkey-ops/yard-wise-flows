import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2, Upload, ExternalLink, Calculator,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { resolveSignedUrl } from "@/lib/storage";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis } from "recharts";

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
  yard_share: number;
  shipping_line_share: number;
  transferred: boolean;
}

interface ShippingLineBreakdown {
  shipping_line: string;
  count: number;
  totalOwed: number;
  transferred: boolean;
}

interface TransferRow {
  shipping_line: string;
  amount_transferred: number;
  receipt_url: string | null;
}

const chartConfig: ChartConfig = {
  collected: { label: "Collected (JOD)", color: "hsl(210 100% 35%)" },
  yard: { label: "Yard Share (JOD)", color: "hsl(142 76% 36%)" },
};

const Accounting = () => {
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transferDialog, setTransferDialog] = useState<{
    open: boolean;
    shippingLine: string;
    amount: number;
  }>({ open: false, shippingLine: "", amount: 0 });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [paymentsRes, transfersRes] = await Promise.all([
      supabase.from("demurrage_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("shipping_line_transfers").select("*").order("transferred_at", { ascending: false }),
    ]);
    if (paymentsRes.data) setPayments(paymentsRes.data as PaymentRow[]);
    if (transfersRes.data) setTransfers(transfersRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Filtered payments based on date range
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      const d = new Date(p.created_at);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (d > to) return false;
      }
      return true;
    });
  }, [payments, dateFrom, dateTo]);

  const summaryCards = useMemo(() => {
    const totalCollected = filteredPayments.reduce((s, p) => s + Number(p.total_collected), 0);
    const yardEarnings = filteredPayments.reduce((s, p) => s + Number(p.yard_share), 0);
    const pendingTransfers = filteredPayments.filter(p => !p.transferred).reduce((s, p) => s + Number(p.shipping_line_share), 0);
    const completedTransfers = transfers.reduce((s, t) => s + Number(t.amount_transferred), 0);
    return { totalCollected, yardEarnings, pendingTransfers, completedTransfers };
  }, [filteredPayments, transfers]);

  const shippingLineBreakdown = useMemo(() => {
    const pending = new Map<string, { count: number; totalOwed: number }>();
    const transferredLines = new Set<string>();
    filteredPayments.forEach(p => {
      if (!p.transferred) {
        const existing = pending.get(p.shipping_line) || { count: 0, totalOwed: 0 };
        existing.count++;
        existing.totalOwed += Number(p.shipping_line_share);
        pending.set(p.shipping_line, existing);
      }
    });
    transfers.forEach(t => transferredLines.add(t.shipping_line));
    const rows: ShippingLineBreakdown[] = [];
    pending.forEach((v, k) => rows.push({ shipping_line: k, ...v, transferred: false }));
    transferredLines.forEach(sl => {
      if (!pending.has(sl)) rows.push({ shipping_line: sl, count: 0, totalOwed: 0, transferred: true });
    });
    return rows;
  }, [filteredPayments, transfers]);

  // Monthly chart data — last 6 months
  const monthlyData = useMemo(() => {
    const months: { month: string; collected: number; yard: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      const monthPayments = payments.filter((p) => {
        const pd = new Date(p.created_at);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      });
      months.push({
        month: key,
        collected: monthPayments.reduce((s, p) => s + Number(p.total_collected), 0),
        yard: monthPayments.reduce((s, p) => s + Number(p.yard_share), 0),
      });
    }
    return months;
  }, [payments]);

  const handleMarkTransferred = async () => {
    if (!receiptFile || !user) return;
    setIsTransferring(true);
    try {
      const fileExt = receiptFile.name.split(".").pop();
      const filePath = `${transferDialog.shippingLine}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from("transfer-receipts").upload(filePath, receiptFile);
      if (uploadError) throw uploadError;
      const yardId = currentYardId();
      if (!yardId) throw new Error("No yard assigned to your account");
      const { error: insertError } = await supabase.from("shipping_line_transfers").insert({
        shipping_line: transferDialog.shippingLine,
        amount_transferred: transferDialog.amount,
        transferred_by: user.id,
        receipt_url: filePath,
        yard_id: yardId,
      });
      if (insertError) throw insertError;
      const pendingIds = payments.filter(p => p.shipping_line === transferDialog.shippingLine && !p.transferred).map(p => p.id);
      if (pendingIds.length > 0) {
        const { error: updateError } = await supabase.from("demurrage_payments").update({ transferred: true }).in("id", pendingIds);
        if (updateError) throw updateError;
      }
      toast({ title: "Transfer Recorded", description: `${transferDialog.amount} JOD marked as transferred to ${transferDialog.shippingLine}.` });
      setTransferDialog({ open: false, shippingLine: "", amount: 0 });
      setReceiptFile(null);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to record transfer.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsTransferring(false);
    }
  };

  const getTransferReceipt = (shippingLine: string) => transfers.find(t => t.shipping_line === shippingLine)?.receipt_url || null;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Calculator}
        title="Accounting"
        subtitle="Track demurrage collections and shipping line transfers"
      />

      {/* Date Range Filter */}
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
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
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
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4"><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-32" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card className="border-l-4 border-l-maritime">
              <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total Collected</CardTitle><DollarSign className="h-4 w-4 text-maritime" /></CardHeader>
              <CardContent><div className="text-2xl font-bold text-maritime">{summaryCards.totalCollected.toFixed(2)} JOD</div></CardContent>
            </Card>
            <Card className="border-l-4 border-l-success">
              <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Yard Earnings</CardTitle><TrendingUp className="h-4 w-4 text-success" /></CardHeader>
              <CardContent><div className="text-2xl font-bold text-success">{summaryCards.yardEarnings.toFixed(2)} JOD</div></CardContent>
            </Card>
            <Card className="border-l-4 border-l-warning">
              <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Pending Transfers</CardTitle><Clock className="h-4 w-4 text-warning" /></CardHeader>
              <CardContent><div className="text-2xl font-bold text-warning">{summaryCards.pendingTransfers.toFixed(2)} JOD</div></CardContent>
            </Card>
            <Card className="border-l-4 border-l-container">
              <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Transferred</CardTitle><CheckCircle2 className="h-4 w-4 text-container" /></CardHeader>
              <CardContent><div className="text-2xl font-bold">{summaryCards.completedTransfers.toFixed(2)} JOD</div></CardContent>
            </Card>
          </>
        )}
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
                <Bar dataKey="collected" fill="hsl(210 100% 35%)" radius={[4, 4, 0, 0]} name="Total Collected" />
                <Bar dataKey="yard" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} name="Yard Share" />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Shipping Line Breakdown */}
      <Card>
        <CardHeader><CardTitle>Shipping Line Breakdown</CardTitle></CardHeader>
        <CardContent>
          {shippingLineBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No shipping line data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead>Payments</TableHead>
                  <TableHead>Owed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shippingLineBreakdown.map(row => (
                  <TableRow key={row.shipping_line}>
                    <TableCell className="font-semibold">{row.shipping_line}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>{row.totalOwed.toFixed(2)} JOD</TableCell>
                    <TableCell>
                      {row.totalOwed > 0
                        ? <Badge variant="destructive">Pending</Badge>
                        : <Badge className="bg-success text-white">Transferred</Badge>}
                    </TableCell>
                    <TableCell>
                      {row.totalOwed > 0 ? (
                        <Button size="sm" className="bg-success hover:bg-success/90 text-white" onClick={() => setTransferDialog({ open: true, shippingLine: row.shipping_line, amount: row.totalOwed })}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Transferred
                        </Button>
                      ) : (
                        (() => {
                          const value = getTransferReceipt(row.shipping_line);
                          return value ? (
                            <button
                              type="button"
                              onClick={async () => {
                                const signed = await resolveSignedUrl("transfer-receipts", value);
                                if (signed) window.open(signed, "_blank", "noopener,noreferrer");
                              }}
                              className="text-primary hover:underline flex items-center gap-1 text-sm"
                            >
                              <ExternalLink className="h-3 w-3" /> View Receipt
                            </button>
                          ) : null;
                        })()
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All Payments */}
      <Card>
        <CardHeader><CardTitle>All Payments {dateFrom || dateTo ? `(filtered)` : ""}</CardTitle></CardHeader>
        <CardContent>
          {filteredPayments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No payments in selected range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Demurrage</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.container_number}</TableCell>
                    <TableCell><Badge variant="outline">{p.shipping_line}</Badge></TableCell>
                    <TableCell>{Number(p.demurrage_amount).toFixed(2)} JOD</TableCell>
                    <TableCell>{Number(p.service_fee).toFixed(2)} JOD</TableCell>
                    <TableCell className="font-semibold">{Number(p.total_collected).toFixed(2)} JOD</TableCell>
                    <TableCell><Badge variant={p.payment_method === "cash" ? "secondary" : "default"}>{p.payment_method}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {p.transferred
                        ? <Badge className="bg-success/10 text-success border-success/30">Transferred</Badge>
                        : <Badge variant="outline" className="text-warning border-warning/30">Pending</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transfer Dialog */}
      <Dialog open={transferDialog.open} onOpenChange={(o) => !o && setTransferDialog(prev => ({ ...prev, open: false }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Transfer to {transferDialog.shippingLine}</DialogTitle>
            <DialogDescription>
              Mark <strong>{transferDialog.amount.toFixed(2)} JOD</strong> as transferred to <strong>{transferDialog.shippingLine}</strong>. Upload a receipt to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Shipping Line</span><span className="font-semibold">{transferDialog.shippingLine}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-bold text-lg">{transferDialog.amount.toFixed(2)} JOD</span></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="receipt">Receipt (Image or PDF) *</Label>
              <Input id="receipt" type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(prev => ({ ...prev, open: false }))}>Cancel</Button>
            <Button className="bg-success hover:bg-success/90 text-white" disabled={!receiptFile || isTransferring} onClick={handleMarkTransferred}>
              {isTransferring ? "Processing…" : <><Upload className="h-4 w-4 mr-1" />Confirm Transfer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Accounting;
