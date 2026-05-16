import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2, Upload, ExternalLink,
} from "lucide-react";

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

const Accounting = () => {
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  const summaryCards = useMemo(() => {
    const totalCollected = payments.reduce((s, p) => s + Number(p.total_collected), 0);
    const yardEarnings = payments.reduce((s, p) => s + Number(p.yard_share), 0);
    const pendingTransfers = payments.filter(p => !p.transferred).reduce((s, p) => s + Number(p.shipping_line_share), 0);
    const completedTransfers = transfers.reduce((s, t) => s + Number(t.amount_transferred), 0);
    return { totalCollected, yardEarnings, pendingTransfers, completedTransfers };
  }, [payments, transfers]);

  const shippingLineBreakdown = useMemo(() => {
    const pending = new Map<string, { count: number; totalOwed: number }>();
    const transferredLines = new Set<string>();

    payments.forEach(p => {
      if (!p.transferred) {
        const existing = pending.get(p.shipping_line) || { count: 0, totalOwed: 0 };
        existing.count++;
        existing.totalOwed += Number(p.shipping_line_share);
        pending.set(p.shipping_line, existing);
      }
    });

    // Check which shipping lines have completed transfers
    transfers.forEach(t => transferredLines.add(t.shipping_line));

    const rows: ShippingLineBreakdown[] = [];
    pending.forEach((v, k) => rows.push({ shipping_line: k, ...v, transferred: false }));
    
    // Add transferred lines that have no pending
    transferredLines.forEach(sl => {
      if (!pending.has(sl)) {
        rows.push({ shipping_line: sl, count: 0, totalOwed: 0, transferred: true });
      }
    });

    return rows;
  }, [payments, transfers]);

  const handleMarkTransferred = async () => {
    if (!receiptFile || !user) return;
    setIsTransferring(true);

    try {
      const fileExt = receiptFile.name.split(".").pop();
      const filePath = `${transferDialog.shippingLine}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("transfer-receipts")
        .upload(filePath, receiptFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("transfer-receipts")
        .getPublicUrl(filePath);

      // Insert transfer record
      const yardId = currentYardId();
      if (!yardId) throw new Error("No yard assigned to your account");
      const { error: insertError } = await supabase
        .from("shipping_line_transfers")
        .insert({
          shipping_line: transferDialog.shippingLine,
          amount_transferred: transferDialog.amount,
          transferred_by: user.id,
          receipt_url: urlData.publicUrl,
          yard_id: yardId,
        });

      if (insertError) throw insertError;

      // Mark all pending payments for this shipping line as transferred
      // We need to use an edge function or RPC for bulk update, but since we have
      // update access via RLS, let's update individually
      const pendingIds = payments
        .filter(p => p.shipping_line === transferDialog.shippingLine && !p.transferred)
        .map(p => p.id);

      for (const id of pendingIds) {
        await supabase
          .from("demurrage_payments")
          .update({ transferred: true })
          .eq("id", id);
      }

      toast({ title: "Transfer Recorded", description: `${transferDialog.amount} JOD marked as transferred to ${transferDialog.shippingLine}.` });
      setTransferDialog({ open: false, shippingLine: "", amount: 0 });
      setReceiptFile(null);
      fetchData();
    } catch (error: unknown) {
      console.error("Transfer error:", error);
      const message = error instanceof Error ? error.message : "Failed to record transfer.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsTransferring(false);
    }
  };

  const getTransferReceipt = (shippingLine: string) => {
    const transfer = transfers.find(t => t.shipping_line === shippingLine);
    return transfer?.receipt_url || null;
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading accounting data...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-foreground">Accounting</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Demurrage Collected</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryCards.totalCollected.toLocaleString()} JOD</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Yard's Total Earnings</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summaryCards.yardEarnings.toLocaleString()} JOD</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Transfers</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summaryCards.pendingTransfers.toLocaleString()} JOD</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Already Transferred</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryCards.completedTransfers.toLocaleString()} JOD</div>
          </CardContent>
        </Card>
      </div>

      {/* Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Demurrage Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No demurrage payments recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead>Demurrage</TableHead>
                  <TableHead>Service Fee</TableHead>
                  <TableHead>Total Collected</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.container_number}</TableCell>
                    <TableCell><Badge variant="outline">{p.shipping_line}</Badge></TableCell>
                    <TableCell>{Number(p.demurrage_amount).toLocaleString()} JOD</TableCell>
                    <TableCell>{Number(p.service_fee)} JOD</TableCell>
                    <TableCell className="font-semibold">{Number(p.total_collected).toLocaleString()} JOD</TableCell>
                    <TableCell>
                      <Badge variant={p.payment_method === "cash" ? "secondary" : "default"}>
                        {p.payment_method}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Shipping Line Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Shipping Line Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {shippingLineBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No shipping line data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead>Payments</TableHead>
                  <TableHead>Owed Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shippingLineBreakdown.map(row => (
                  <TableRow key={row.shipping_line}>
                    <TableCell className="font-semibold">{row.shipping_line}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>{row.totalOwed.toLocaleString()} JOD</TableCell>
                    <TableCell>
                      {row.totalOwed > 0 ? (
                        <Badge variant="destructive">Pending</Badge>
                      ) : (
                        <Badge className="bg-green-600">Transferred</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.totalOwed > 0 ? (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => setTransferDialog({
                            open: true,
                            shippingLine: row.shipping_line,
                            amount: row.totalOwed,
                          })}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Mark as Transferred
                        </Button>
                      ) : (
                        (() => {
                          const url = getTransferReceipt(row.shipping_line);
                          return url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-sm">
                              <ExternalLink className="h-3 w-3" />
                              View Receipt
                            </a>
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

      {/* Transfer Confirmation Dialog */}
      <Dialog open={transferDialog.open} onOpenChange={(o) => !o && setTransferDialog(prev => ({ ...prev, open: false }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Transfer to {transferDialog.shippingLine}</DialogTitle>
            <DialogDescription>
              You are about to mark <strong>{transferDialog.amount.toLocaleString()} JOD</strong> as transferred to <strong>{transferDialog.shippingLine}</strong>. Please upload a receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping Line</span>
                <span className="font-semibold">{transferDialog.shippingLine}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Transfer Amount</span>
                <span className="font-bold text-lg">{transferDialog.amount.toLocaleString()} JOD</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="receipt">Upload Receipt (Image or PDF) *</Label>
              <Input
                id="receipt"
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(prev => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={!receiptFile || isTransferring}
              onClick={handleMarkTransferred}
            >
              {isTransferring ? "Processing..." : (
                <>
                  <Upload className="h-4 w-4 mr-1" />
                  Confirm Transfer
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Accounting;
