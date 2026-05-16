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

  // Calculate demurrage inline
  const demurragePreview = useMemo(() => {
    const { portArrivalDate, freeDays, dailyDemurrage } = formData;
    if (!portArrivalDate || !freeDays || !dailyDemurrage) return null;

    const arrival = new Date(portArrivalDate);
    const today = new Date();
    // Reset time to midnight for day-level calculation
    arrival.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));
    const chargeableDays = diffDays - parseInt(freeDays);
    const amount = chargeableDays > 0 ? chargeableDays * parseFloat(dailyDemurrage) : 0;

    return { diffDays, chargeableDays, amount };
  }, [formData.portArrivalDate, formData.freeDays, formData.dailyDemurrage]);

  const hasDemurrageDue =
    !demurrageAlreadyPaid &&
    demurragePreview != null &&
    demurragePreview.amount > 0;

  const portDataComplete =
    !!formData.portArrivalDate &&
    formData.freeDays !== "" &&
    formData.dailyDemurrage !== "" &&
    parseFloat(formData.dailyDemurrage) > 0;

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

    const result = gateInSchema.safeParse(formData);
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    if (!formData.portArrivalDate || !formData.freeDays || !formData.dailyDemurrage) {
      toast({
        title: "Port Data Required",
        description: "Enter port arrival date, free days, and daily rate.",
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

      // 2) Demurrage check BEFORE gate-in — but skip entirely if a payment
      //    has already been collected for this container (since the last
      //    gate-out, or ever if it has never been gated out).
      if (!demurrageAlreadyPaid) {
        const { data: demurrageRow, error: demurrageError } = await supabase
          .from("container_demurrage")
          .select("*")
          .eq("container_number", containerNumber)
          .maybeSingle();

        if (demurrageError) {
          console.error("Error checking demurrage:", demurrageError);
          toast({
            title: "Demurrage Check Failed",
            description: "Could not verify demurrage. Please try again or check port data.",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        if (demurrageRow) {
          const { chargeable_days, demurrage_amount } = demurrageRow as DemurrageRow;
          if (chargeable_days > 0) {
            // Show styled dialog — pause submission until cash is collected
            setDemurrageDialog({
              open: true,
              chargeableDays: chargeable_days,
              demurrageAmount: demurrage_amount,
              containerNumber,
            });
            setIsSubmitting(false);
            return;
          }
        }
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
          free_days: parseInt(formData.freeDays),
          daily_demurrage: parseFloat(formData.dailyDemurrage),
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
                    Enter the port arrival date, free days allowance, and daily demurrage rate below.
                    These values are required before gate-in can proceed.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="portArrivalDate">Port Arrival Date *</Label>
                  <Input
                    id="portArrivalDate"
                    type="date"
                    value={formData.portArrivalDate}
                    onChange={(e) => setFormData({ ...formData, portArrivalDate: e.target.value })}
                    readOnly={portDataFound}
                    max={new Date().toISOString().split('T')[0]}
                    className={portDataFound ? "bg-muted cursor-not-allowed" : ""}
                  />
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
                    placeholder="e.g., 7"
                    readOnly={portDataFound}
                    className={portDataFound ? "bg-muted cursor-not-allowed" : ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dailyDemurrage">Daily Demurrage (JOD) *</Label>
                  <Input
                    id="dailyDemurrage"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.dailyDemurrage}
                    onChange={(e) => setFormData({ ...formData, dailyDemurrage: e.target.value })}
                    placeholder="e.g., 15"
                    readOnly={portDataFound}
                    className={portDataFound ? "bg-muted cursor-not-allowed" : ""}
                  />
                </div>
              </div>

              {alreadyInYard && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-800 text-sm">
                  ⚠️ This container is already in the yard. It must be gated out before it can be gated in again.
                </div>
              )}

              {!alreadyInYard && demurrageAlreadyPaid && demurragePreview && demurragePreview.amount > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
                  ✅ Demurrage already paid for this container — no further collection required.
                </div>
              )}

              {!demurrageAlreadyPaid && demurragePreview && demurragePreview.amount > 0 && (
                <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm space-y-3">
                  <p className="font-medium">⚠️ Demurrage Due — Gate-in blocked</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span>Demurrage ({demurragePreview.chargeableDays} days × {parseFloat(formData.dailyDemurrage)} JOD)</span><strong>{demurragePreview.amount.toLocaleString()} JOD</strong></div>
                    <div className="flex justify-between"><span>Service Fee</span><strong>{SERVICE_FEE} JOD</strong></div>
                    <div className="flex justify-between border-t border-red-200 pt-1 text-sm"><span className="font-semibold">Total to Collect</span><strong>{(demurragePreview.amount + SERVICE_FEE).toLocaleString()} JOD</strong></div>
                  </div>
                  <Button
                    type="button"
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => {
                      // Validate required fields before opening payment dialog
                      if (!formData.containerNumber || !formData.shippingLine) {
                        toast({
                          title: "Missing info",
                          description: "Please fill in container number and shipping line first.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setDemurrageDialog({
                        open: true,
                        chargeableDays: demurragePreview.chargeableDays,
                        demurrageAmount: demurragePreview.amount,
                        containerNumber: formData.containerNumber.trim().toUpperCase(),
                      });
                    }}
                  >
                    💵 Collect Payment & Print Receipt
                  </Button>
                </div>
              )}

              {demurragePreview && demurragePreview.amount === 0 && formData.portArrivalDate && (
                <div className="mt-4 p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
                  ✅ No demurrage due — {demurragePreview.chargeableDays <= 0 ? `${Math.abs(demurragePreview.chargeableDays)} free day(s) remaining` : "within free period"}.
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