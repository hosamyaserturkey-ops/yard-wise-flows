import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container, AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { GateInData } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { gateInSchema } from "@/lib/validation";
import bgGateIn from "@/assets/bg-gate-in.jpg";
import DemurrageCollectionDialog, { SERVICE_FEE, YARD_SHARE, SHIPPING_LINE_SHARE } from "@/components/DemurrageCollectionDialog";
import { SHIPPING_LINES } from "@/lib/shippingLines";
import type { ShippingLine } from "@/lib/shippingLines";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  calculateDemurrage,
  hasDemurrageRules,
  toDemurrageContainerType,
  DEMURRAGE_RULES,
  USD_TO_JOD,
} from "@/lib/demurrage";

interface DemurrageRow {
  chargeable_days: number;
  demurrage_amount: number;
}

interface InsertedContainerRow {
  id: string;
  container_number: string;
  container_type: string;
  shipping_line: string;
  driver_name: string;
  truck_number: string;
  gate_in_time: string;
}

const GateIn = () => {
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState<GateInData>({
    containerNumber: "",
    containerType: "",
    shippingLine: "SLD",
    driverName: "",
    truckNumber: "",
    portArrivalDate: "",
    freeDays: "",
    dailyDemurrage: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [portDataFound, setPortDataFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [demurrageAlreadyPaid, setDemurrageAlreadyPaid] = useState(false);
  const [alreadyInYard, setAlreadyInYard] = useState(false);
  const [demurrageDialog, setDemurrageDialog] = useState<{
    open: boolean;
    chargeableDays: number;
    demurrageAmount: number;
    containerNumber: string;
  }>({ open: false, chargeableDays: 0, demurrageAmount: 0, containerNumber: "" });

  // Debounced lookup of container_port_data when container number changes
  useEffect(() => {
    const containerNum = formData.containerNumber.trim().toUpperCase();
    if (containerNum.length < 4) {
      setPortDataFound(false);
      setLookupDone(false);
      setDemurrageAlreadyPaid(false);
      setAlreadyInYard(false);
      return;
    }

    const timer = setTimeout(async () => {
      // Port data lookup
      const { data } = await supabase
        .from("container_port_data")
        .select("port_arrival_date, free_days, daily_demurrage, shipping_line")
        .eq("container_number", containerNum)
        .maybeSingle();

      if (data) {
        setFormData(prev => ({
          ...prev,
          portArrivalDate: data.port_arrival_date,
          freeDays: String(data.free_days),
          dailyDemurrage: String(data.daily_demurrage),
          shippingLine: data.shipping_line as ShippingLine,
        }));
        setPortDataFound(true);
      } else {
        setFormData(prev => ({
          ...prev,
          portArrivalDate: "",
          freeDays: "",
          dailyDemurrage: "",
        }));
        setPortDataFound(false);
      }

      // Already-in-yard check
      const { data: inYardRow } = await supabase
        .from("containers")
        .select("id")
        .eq("container_number", containerNum)
        .eq("status", "in-yard")
        .maybeSingle();
      setAlreadyInYard(!!inYardRow);

      // Demurrage already paid check:
      // a payment "covers" the next gate-in if it was made after the most
      // recent gate-out for this container (or the container has never been
      // gated out and any payment exists).
      const { data: lastGateOutRow } = await supabase
        .from("containers")
        .select("gate_out_time")
        .eq("container_number", containerNum)
        .not("gate_out_time", "is", null)
        .order("gate_out_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      let paymentQuery = supabase
        .from("demurrage_payments")
        .select("id, created_at")
        .eq("container_number", containerNum)
        .order("created_at", { ascending: false })
        .limit(1);

      if (lastGateOutRow?.gate_out_time) {
        paymentQuery = paymentQuery.gt("created_at", lastGateOutRow.gate_out_time);
      }

      const { data: paymentRow } = await paymentQuery.maybeSingle();
      setDemurrageAlreadyPaid(!!paymentRow);

      setLookupDone(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.containerNumber]);

  // Auto-fill free days when shipping line changes (if rules exist for it)
  useEffect(() => {
    if (hasDemurrageRules(formData.shippingLine)) {
      const rule = DEMURRAGE_RULES[formData.shippingLine];
      setFormData(prev =>
        prev.freeDays === String(rule.freeDays)
          ? prev
          : { ...prev, freeDays: String(rule.freeDays) }
      );
    }
  }, [formData.shippingLine]);

  // New tiered demurrage calculation
  const demurragePreview = useMemo(() => {
    if (!formData.portArrivalDate || !formData.containerType) return null;
    const result = calculateDemurrage(
      formData.shippingLine,
      formData.containerType,
      formData.portArrivalDate,
    );
    return result;
  }, [
    formData.portArrivalDate,
    formData.containerType,
    formData.shippingLine,
  ]);

  const portArrivalIsFuture = useMemo(() => {
    if (!formData.portArrivalDate) return false;
    const a = new Date(formData.portArrivalDate);
    const today = new Date();
    a.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return a.getTime() > today.getTime();
  }, [formData.portArrivalDate]);

  const hasDemurrageDue =
    !demurrageAlreadyPaid &&
    demurragePreview != null &&
    demurragePreview.totalJOD > 0;

  // Port data is "complete enough" to gate in as long as arrival date is set and not in the future.
  const portDataComplete =
    !!formData.portArrivalDate && !portArrivalIsFuture;

  const showNoPortDataWarning = lookupDone && !portDataFound;


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to gate in containers.",
        variant: "destructive",
      });
      return;
    }

    // dailyDemurrage is no longer collected from the user — supply a placeholder
    // so the existing schema (which still requires it) keeps passing.
    const dataForValidation = {
      ...formData,
      freeDays: formData.freeDays || "0",
      dailyDemurrage: "0",
    };
    const result = gateInSchema.safeParse(dataForValidation);
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    if (!formData.portArrivalDate) {
      toast({
        title: "Port Arrival Date Required",
        description: "Enter the port arrival date before gating in.",
        variant: "destructive",
      });
      return;
    }

    if (portArrivalIsFuture) {
      toast({
        title: "Invalid Port Arrival Date",
        description: "Port arrival date cannot be in the future.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const containerNumber = formData.containerNumber.trim().toUpperCase();

      // 1) Block double gate-in: if this container is currently in the yard,
      //    refuse before doing anything else (so we never re-prompt for payment).
      const { data: inYardRow } = await supabase
        .from("containers")
        .select("id")
        .eq("container_number", containerNumber)
        .eq("status", "in-yard")
        .maybeSingle();

      if (inYardRow) {
        toast({
          title: "Container Already In Yard",
          description: "This container is already gated in. Gate it out before gating in again.",
          variant: "destructive",
        });
        setAlreadyInYard(true);
        setIsSubmitting(false);
        return;
      }

      // 2) Demurrage check BEFORE gate-in using the new tiered calculation,
      //    skipped if already paid since the last gate-out.
      if (!demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0) {
        const chargeableDays = Math.max(
          0,
          demurragePreview.daysElapsed - demurragePreview.freeDays,
        );
        setDemurrageDialog({
          open: true,
          chargeableDays,
          demurrageAmount: demurragePreview.totalJOD,
          containerNumber,
        });
        setIsSubmitting(false);
        return;
      }

      // Upsert port data for demurrage tracking
      const yardIdForPort = currentYardId();
      if (!yardIdForPort) {
        toast({ title: "Error", description: "No yard assigned", variant: "destructive" });
        setIsSubmitting(false);
        return;
      }
      await supabase
        .from('container_port_data')
        .upsert({
          container_number: containerNumber,
          shipping_line: formData.shippingLine,
          port_arrival_date: formData.portArrivalDate,
          free_days: parseInt(formData.freeDays || "0"),
          daily_demurrage: 0,
          last_source: portDataFound ? 'gate-in' : 'gate-in-manual',
          yard_id: yardIdForPort,
        }, { onConflict: 'container_number' });


      // No demurrage (or already paid) — proceed directly
      await insertContainer(containerNumber);
    } catch (error) {
      console.error('Error gating in container:', error);
      toast({
        title: "Error",
        description: "Failed to gate in container. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const insertContainer = async (containerNumber: string) => {
    // Check if container already exists in yard
    const { data: existingContainer } = await supabase
      .from('containers')
      .select('id')
      .eq('container_number', containerNumber)
      .eq('status', 'in-yard')
      .maybeSingle();

    if (existingContainer) {
      toast({
        title: "Container Already In Yard",
        description: "This container is already gated in.",
        variant: "destructive",
      });
      return;
    }

    const yardId = currentYardId();
    if (!yardId) throw new Error("No yard assigned to your account");
    const { data, error } = await supabase
      .from('containers')
      .insert({
        container_number: containerNumber,
        container_type: formData.containerType,
        shipping_line: formData.shippingLine,
        driver_name: formData.driverName,
        truck_number: formData.truckNumber,
        created_by: user!.id,
        yard_id: yardId,
      })
      .select()
      .single();

    if (error) throw error;

    toast({
      title: "Success",
      description: `Container ${containerNumber} gated in successfully`,
    });

    printReceipt(data);

    setFormData({
      containerNumber: "",
      containerType: "",
      shippingLine: "SLD",
      driverName: "",
      truckNumber: "",
      portArrivalDate: "",
      freeDays: "",
      dailyDemurrage: "",
    });
    setPortDataFound(false);
    setLookupDone(false);
    setDemurrageAlreadyPaid(false);
    setAlreadyInYard(false);
  };

  const printReceipt = (containerData: InsertedContainerRow) => {
    const receiptWindow = window.open('', '_blank');
    if (!receiptWindow) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-in receive note.",
        variant: "destructive",
      });
      return;
    }
    receiptWindow.document.write(`
      <html>
        <head>
          <title>Gate In Receive Note - ${containerData.container_number}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; color: #111; }
            .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 12px; }
            .header h2 { margin: 0; }
            .header h3 { margin: 6px 0; letter-spacing: 1px; }
            .meta { font-size: 0.85em; color: #555; }
            .content { margin: 20px 0; }
            .row { margin: 10px 0; display: flex; justify-content: space-between; border-bottom: 1px dashed #ddd; padding-bottom: 6px; }
            .label { font-weight: bold; }
            .value { font-family: 'Courier New', monospace; }
            .footer { text-align: center; margin-top: 24px; font-size: 0.8em; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
            .signatures { display: flex; justify-content: space-between; margin-top: 40px; font-size: 0.85em; }
            .sig { width: 45%; border-top: 1px solid #333; padding-top: 6px; text-align: center; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>Container Yard Management</h2>
            <h3>GATE IN — RECEIVE NOTE</h3>
            <p class="meta">Receipt #: GI-${containerData.id.substring(0, 8).toUpperCase()}</p>
            <p class="meta">${new Date(containerData.gate_in_time).toLocaleString()}</p>
          </div>
          <div class="content">
            <div class="row"><span class="label">Container Number</span><span class="value">${containerData.container_number}</span></div>
            <div class="row"><span class="label">Container Type</span><span class="value">${containerData.container_type}</span></div>
            <div class="row"><span class="label">Shipping Line</span><span class="value">${containerData.shipping_line}</span></div>
            <div class="row"><span class="label">Driver Name</span><span class="value">${containerData.driver_name}</span></div>
            <div class="row"><span class="label">Truck Number</span><span class="value">${containerData.truck_number}</span></div>
          </div>
          <div class="signatures">
            <div class="sig">Driver Signature</div>
            <div class="sig">Gate Officer</div>
          </div>
          <div class="footer">
            <p>Please retain this receive note as proof of yard entry.</p>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 200);
            };
          </script>
        </body>
      </html>
    `);
    receiptWindow.document.close();
  };

  const printDemurrageReceipt = (data: {
    id: string;
    containerNumber: string;
    shippingLine: string;
    chargeableDays: number;
    demurrageAmount: number;
    handlingFee: number;
    totalCollected: number;
  }) => {
    const receiptWindow = window.open('', '_blank');
    if (receiptWindow) {
      receiptWindow.document.write(`
        <html>
          <head>
            <title>Demurrage Receipt</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; max-width: 400px; margin: 0 auto; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
              .content { margin: 20px 0; }
              .row { margin: 8px 0; display: flex; justify-content: space-between; }
              .label { font-weight: bold; }
              .total { border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; font-size: 1.2em; }
              .footer { text-align: center; margin-top: 20px; font-size: 0.85em; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>Container Yard Management</h2>
              <h3>DEMURRAGE PAYMENT RECEIPT</h3>
              <p>Receipt #: DM-${data.id.substring(0, 8).toUpperCase()}</p>
              <p>${new Date().toLocaleString()}</p>
            </div>
            <div class="content">
              <div class="row"><span class="label">Container:</span> <span>${data.containerNumber}</span></div>
              <div class="row"><span class="label">Shipping Line:</span> <span>${data.shippingLine}</span></div>
              <div class="row"><span class="label">Chargeable Days:</span> <span>${data.chargeableDays} days</span></div>
              <div class="row"><span class="label">Demurrage Amount:</span> <span>${data.demurrageAmount.toLocaleString()} JOD</span></div>
              <div class="row"><span class="label">Handling Fee:</span> <span>${data.handlingFee} JOD</span></div>
              <div class="row total"><span class="label">Total Collected:</span> <span>${data.totalCollected.toLocaleString()} JOD</span></div>
            </div>
            <div class="footer">
              <p>Payment Method: Cash</p>
              <p>This receipt confirms demurrage payment has been collected.</p>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() { window.print(); }, 200);
              };
            </script>
          </body>
        </html>
      `);
      receiptWindow.document.close();
    }
  };

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgGateIn})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="max-w-2xl mx-auto space-y-6 relative z-10">
      <div className="flex items-center space-x-2">
        <Container className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">Gate In Container</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Container Entry Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="containerNumber">Container Number *</Label>
                <Input
                  id="containerNumber"
                  value={formData.containerNumber}
                  onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g., SLDX123456"
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="containerType">Container Type *</Label>
                <Select
                  value={formData.containerType}
                  onValueChange={(value) => setFormData({ ...formData, containerType: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select container type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20FT">20FT Standard</SelectItem>
                    <SelectItem value="40FT">40FT Standard</SelectItem>
                    <SelectItem value="40HC">40FT High Cube</SelectItem>
                    <SelectItem value="45FT">45FT High Cube</SelectItem>
                    <SelectItem value="20FR">20FT Reefer</SelectItem>
                    <SelectItem value="40FR">40FT Reefer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="shippingLine">Shipping Line *</Label>
                <Select
                  value={formData.shippingLine}
                  onValueChange={(value) => setFormData({ ...formData, shippingLine: value as ShippingLine })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select shipping line" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPPING_LINES.map((sl) => (
                      <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="driverName">Driver Name *</Label>
                <Input
                  id="driverName"
                  value={formData.driverName}
                  onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                  placeholder="Enter driver's full name"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="truckNumber">Truck Number *</Label>
                <Input
                  id="truckNumber"
                  value={formData.truckNumber}
                  onChange={(e) => setFormData({ ...formData, truckNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g., TRK001"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                Port & Demurrage Information
                {portDataFound && (
                  <span className="ml-2 text-xs text-green-600 font-normal">(Auto-filled from port data)</span>
                )}
              </h3>

              {showNoPortDataWarning && (
                <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>No port data found for this container</AlertTitle>
                  <AlertDescription>
                    Enter the port arrival date below. Demurrage will be calculated automatically from the shipping line's tier rules. You can still proceed with gate-in.
                  </AlertDescription>
                </Alert>
              )}

              <Tabs defaultValue="port" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="port">Port & Demurrage</TabsTrigger>
                  <TabsTrigger value="line">Shipping Line</TabsTrigger>
                </TabsList>

                <TabsContent value="port" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="portArrivalDate">Port Arrival Date *</Label>
                      <Input
                        id="portArrivalDate"
                        type="date"
                        value={formData.portArrivalDate}
                        onChange={(e) => setFormData({ ...formData, portArrivalDate: e.target.value })}
                        max={new Date().toISOString().split('T')[0]}
                      />
                      {portArrivalIsFuture && (
                        <p className="text-xs text-destructive">Port arrival date cannot be in the future.</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="freeDays">Free Days *</Label>
                      <Input
                        id="freeDays"
                        type="number"
                        min="0"
                        max="365"
                        value={formData.freeDays}
                        onChange={(e) => setFormData({ ...formData, freeDays: e.target.value })}
                        placeholder="Auto from shipping line"
                      />
                      {hasDemurrageRules(formData.shippingLine) && (
                        <p className="text-xs text-muted-foreground">
                          {formData.shippingLine} default: {DEMURRAGE_RULES[formData.shippingLine].freeDays} days
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Demurrage calculation result */}
                  {demurragePreview && formData.portArrivalDate && !portArrivalIsFuture && (
                    <div className="rounded-md border bg-card p-4 space-y-3">
                      {demurragePreview.totalJOD === 0 ? (
                        <div className="p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
                          ✅ No demurrage due — {Math.max(0, demurragePreview.freeDays - demurragePreview.daysElapsed)} free day(s) remaining.
                          <div className="text-xs mt-1 text-green-600">
                            {demurragePreview.daysElapsed} day(s) elapsed since port arrival, {demurragePreview.freeDays} free.
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Demurrage Due</p>
                              <p className="text-2xl font-bold text-destructive">
                                {demurragePreview.totalJOD.toLocaleString()} JOD
                              </p>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Subtotal: ${demurragePreview.totalUSD.toLocaleString()} USD
                            </p>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border">
                              <thead className="bg-muted">
                                <tr>
                                  <th className="text-left p-2">Period</th>
                                  <th className="text-right p-2">Days</th>
                                  <th className="text-right p-2">Rate (USD/day)</th>
                                  <th className="text-right p-2">Subtotal (USD)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {demurragePreview.breakdown.map((row, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="p-2">{row.period}</td>
                                    <td className="p-2 text-right">{row.days}</td>
                                    <td className="p-2 text-right">${row.rateUSD}</td>
                                    <td className="p-2 text-right">${row.subtotalUSD.toLocaleString()}</td>
                                  </tr>
                                ))}
                                <tr className="border-t font-semibold bg-muted/50">
                                  <td className="p-2" colSpan={3}>Total (USD)</td>
                                  <td className="p-2 text-right">${demurragePreview.totalUSD.toLocaleString()}</td>
                                </tr>
                                <tr className="border-t text-muted-foreground">
                                  <td className="p-2" colSpan={3}>Exchange Rate</td>
                                  <td className="p-2 text-right">1 USD = {USD_TO_JOD} JOD</td>
                                </tr>
                                <tr className="border-t font-bold bg-destructive/10 text-destructive">
                                  <td className="p-2" colSpan={3}>Total (JOD)</td>
                                  <td className="p-2 text-right">{demurragePreview.totalJOD.toLocaleString()} JOD</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {!hasDemurrageRules(formData.shippingLine) && formData.portArrivalDate && (
                    <p className="text-xs text-muted-foreground">
                      No tiered demurrage rules configured for {formData.shippingLine}. No demurrage will be charged.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="line" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="shippingLineTab">Shipping Line *</Label>
                    <Select
                      value={formData.shippingLine}
                      onValueChange={(value) => setFormData({ ...formData, shippingLine: value as ShippingLine })}
                    >
                      <SelectTrigger id="shippingLineTab">
                        <SelectValue placeholder="Select shipping line" />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIPPING_LINES.map((sl) => (
                          <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Synced with the Shipping Line field above.
                    </p>
                  </div>

                  {hasDemurrageRules(formData.shippingLine) ? (
                    <div className="rounded-md border overflow-x-auto">
                      <div className="bg-muted px-3 py-2 text-sm font-semibold">
                        {formData.shippingLine} — Demurrage Tier Rules
                      </div>
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2">Period</th>
                            <th className="text-right p-2">20FT (USD/day)</th>
                            <th className="text-right p-2">40FT (USD/day)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {DEMURRAGE_RULES[formData.shippingLine].tiers.map((tier, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2">{tier.label}</td>
                              <td className="p-2 text-right">{tier.rate20 === 0 ? "Free" : `$${tier.rate20}`}</td>
                              <td className="p-2 text-right">{tier.rate40 === 0 ? "Free" : `$${tier.rate40}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {formData.containerType && (
                        <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                          Applied rate column for this container: <strong>{toDemurrageContainerType(formData.containerType)}</strong>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No tier rules configured for {formData.shippingLine}.
                    </p>
                  )}
                </TabsContent>
              </Tabs>

              {alreadyInYard && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-800 text-sm">
                  ⚠️ This container is already in the yard. It must be gated out before it can be gated in again.
                </div>
              )}

              {!alreadyInYard && demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
                  ✅ Demurrage already paid for this container — no further collection required.
                </div>
              )}

              {!demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (
                <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm space-y-3">
                  <p className="font-medium">⚠️ Demurrage Due — Collect payment before gate-in</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span>Demurrage Total</span><strong>{demurragePreview.totalJOD.toLocaleString()} JOD</strong></div>
                    <div className="flex justify-between"><span>Service Fee</span><strong>{SERVICE_FEE} JOD</strong></div>
                    <div className="flex justify-between border-t border-red-200 pt-1 text-sm"><span className="font-semibold">Total to Collect</span><strong>{(demurragePreview.totalJOD + SERVICE_FEE).toLocaleString()} JOD</strong></div>
                  </div>
                  <Button
                    type="button"
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => {
                      if (!formData.containerNumber || !formData.shippingLine) {
                        toast({
                          title: "Missing info",
                          description: "Please fill in container number and shipping line first.",
                          variant: "destructive",
                        });
                        return;
                      }
                      const chargeableDays = Math.max(
                        0,
                        demurragePreview.daysElapsed - demurragePreview.freeDays,
                      );
                      setDemurrageDialog({
                        open: true,
                        chargeableDays,
                        demurrageAmount: demurragePreview.totalJOD,
                        containerNumber: formData.containerNumber.trim().toUpperCase(),
                      });
                    }}
                  >
                    💵 Collect Payment & Print Receipt
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFormData({
                    containerNumber: "",
                    containerType: "",
                    shippingLine: "SLD",
                    driverName: "",
                    truckNumber: "",
                    portArrivalDate: "",
                    freeDays: "",
                    dailyDemurrage: "",
                  });
                  setPortDataFound(false);
                  setLookupDone(false);
                  setDemurrageAlreadyPaid(false);
                  setAlreadyInYard(false);
                }}
              >
                Clear Form
              </Button>
              <Button 
                type="submit" 
                className="bg-maritime hover:bg-maritime/90"
                disabled={isSubmitting || hasDemurrageDue || alreadyInYard || !portDataComplete}
              >
                {isSubmitting
                  ? "Processing..."
                  : alreadyInYard
                    ? "Already In Yard — Cannot Gate In"
                    : hasDemurrageDue
                      ? "Demurrage Due — Cannot Gate In"
                      : !portDataComplete && lookupDone && !portDataFound
                        ? "Port Data Required — Cannot Gate In"
                        : !portDataComplete
                          ? "Enter Container Number"
                          : "Gate In & Print Receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      </div>

      <DemurrageCollectionDialog
        open={demurrageDialog.open}
        onClose={() => setDemurrageDialog(prev => ({ ...prev, open: false }))}
        onCollected={async (paymentMethod: "cash" | "qlick") => {
          const { containerNumber, chargeableDays, demurrageAmount } = demurrageDialog;
          const totalCollected = demurrageAmount + SERVICE_FEE;
          setDemurrageDialog(prev => ({ ...prev, open: false }));
          setIsSubmitting(true);
          try {
            const yardIdPay = currentYardId();
            if (!yardIdPay) throw new Error("No yard assigned to your account");
            const { data: paymentRecord, error: paymentError } = await supabase
              .from('demurrage_payments')
              .insert({
                container_number: containerNumber,
                shipping_line: formData.shippingLine,
                chargeable_days: chargeableDays,
                demurrage_amount: demurrageAmount,
                handling_fee: SERVICE_FEE,
                total_collected: totalCollected,
                collected_by: user!.id,
                service_fee: SERVICE_FEE,
                yard_share: YARD_SHARE,
                shipping_line_share: SHIPPING_LINE_SHARE,
                payment_method: paymentMethod,
                yard_id: yardIdPay,
              })
              .select()
              .single();

            if (paymentError) throw paymentError;

            // Mark this container as paid so the dialog/banner won't reappear
            // if the user lingers on or revisits the form before the lookup
            // refreshes from the database.
            setDemurrageAlreadyPaid(true);

            printDemurrageReceipt({
              id: paymentRecord.id,
              containerNumber,
              shippingLine: formData.shippingLine,
              chargeableDays,
              demurrageAmount,
              handlingFee: SERVICE_FEE,
              totalCollected,
            });

            // Small delay so the demurrage receipt window opens cleanly
            // before the gate-in receive note pop-up is triggered.
            await new Promise((r) => setTimeout(r, 600));
            await insertContainer(containerNumber);
          } catch (error) {
            console.error('Error gating in container:', error);
            toast({
              title: "Error",
              description: "Failed to gate in container. Please try again.",
              variant: "destructive",
            });
          } finally {
            setIsSubmitting(false);
          }
        }}
        chargeableDays={demurrageDialog.chargeableDays}
        demurrageAmount={demurrageDialog.demurrageAmount}
        containerNumber={demurrageDialog.containerNumber}
      />
    </div>
  );
};

export default GateIn;