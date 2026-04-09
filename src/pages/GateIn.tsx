import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container } from "lucide-react";
import { GateInData } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { gateInSchema } from "@/lib/validation";
import bgGateIn from "@/assets/bg-gate-in.jpg";
import DemurrageCollectionDialog, { HANDLING_FEE } from "@/components/DemurrageCollectionDialog";

const GateIn = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState<GateInData>({
    containerNumber: "",
    containerType: "",
    shippingLine: "SLD",
    driverName: "",
    truckNumber: "",
    portArrivalDate: "",
    freeDays: "7",
    dailyDemurrage: "15",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [portDataFound, setPortDataFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
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
      return;
    }

    const timer = setTimeout(async () => {
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
          shippingLine: data.shipping_line as 'SLD' | 'SLG',
        }));
        setPortDataFound(true);
      } else {
        setPortDataFound(false);
      }
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

  const hasDemurrageDue = demurragePreview != null && demurragePreview.amount > 0;

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

    setIsSubmitting(true);
    
    try {
      const containerNumber = formData.containerNumber.trim().toUpperCase();

      // 1) Demurrage check BEFORE gate-in
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
        const { chargeable_days, demurrage_amount } = demurrageRow as any;
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

      // Upsert port data for demurrage tracking
      await supabase
        .from('container_port_data')
        .upsert({
          container_number: containerNumber,
          shipping_line: formData.shippingLine,
          port_arrival_date: formData.portArrivalDate,
          free_days: parseInt(formData.freeDays),
          daily_demurrage: parseFloat(formData.dailyDemurrage),
          last_source: 'gate-in',
        }, { onConflict: 'container_number' });

      // No demurrage — proceed directly
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

    const { data, error } = await supabase
      .from('containers')
      .insert({
        container_number: containerNumber,
        container_type: formData.containerType,
        shipping_line: formData.shippingLine,
        driver_name: formData.driverName,
        truck_number: formData.truckNumber,
        created_by: user!.id,
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
      freeDays: "7",
      dailyDemurrage: "15",
    });
  };

  const printReceipt = (containerData: any) => {
    const receiptWindow = window.open('', '_blank');
    if (receiptWindow) {
      receiptWindow.document.write(`
        <html>
          <head>
            <title>Gate In Receipt</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
              .content { margin: 20px 0; }
              .row { margin: 10px 0; }
              .label { font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>Container Yard Management</h2>
              <h3>GATE IN RECEIPT</h3>
              <p>Receipt #: GI-${containerData.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div class="content">
              <div class="row"><span class="label">Container Number:</span> ${containerData.container_number}</div>
              <div class="row"><span class="label">Container Type:</span> ${containerData.container_type}</div>
              <div class="row"><span class="label">Shipping Line:</span> ${containerData.shipping_line}</div>
              <div class="row"><span class="label">Driver Name:</span> ${containerData.driver_name}</div>
              <div class="row"><span class="label">Truck Number:</span> ${containerData.truck_number}</div>
              <div class="row"><span class="label">Gate In Time:</span> ${new Date(containerData.gate_in_time).toLocaleString()}</div>
            </div>
          </body>
        </html>
      `);
      receiptWindow.document.close();
      receiptWindow.print();
    }
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
          </body>
        </html>
      `);
      receiptWindow.document.close();
      receiptWindow.print();
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
                  onValueChange={(value: 'SLD' | 'SLG') => setFormData({ ...formData, shippingLine: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SLD">SLD</SelectItem>
                    <SelectItem value="SLG">SLG</SelectItem>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="portArrivalDate">Port Arrival Date *</Label>
                  <Input
                    id="portArrivalDate"
                    type="date"
                    value={formData.portArrivalDate}
                    onChange={(e) => setFormData({ ...formData, portArrivalDate: e.target.value })}
                    readOnly={portDataFound}
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

              {demurragePreview && demurragePreview.amount > 0 && (
                <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm font-medium">
                  ⚠️ Demurrage Due: <strong>{demurragePreview.chargeableDays} chargeable day(s)</strong> × {parseFloat(formData.dailyDemurrage)} JOD = <strong>{demurragePreview.amount.toLocaleString()} JOD</strong>. Gate-in is blocked until demurrage is collected.
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
                    freeDays: "7",
                    dailyDemurrage: "15",
                  });
                  setPortDataFound(false);
                  setLookupDone(false);
                }}
              >
                Clear Form
              </Button>
              <Button 
                type="submit" 
                className="bg-maritime hover:bg-maritime/90"
                disabled={isSubmitting || hasDemurrageDue}
              >
                {isSubmitting ? "Processing..." : hasDemurrageDue ? "Demurrage Due — Cannot Gate In" : "Gate In & Print Receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      </div>

      <DemurrageCollectionDialog
        open={demurrageDialog.open}
        onClose={() => setDemurrageDialog(prev => ({ ...prev, open: false }))}
        onCollected={async () => {
          const { containerNumber, chargeableDays, demurrageAmount } = demurrageDialog;
          const totalCollected = demurrageAmount + HANDLING_FEE;
          setDemurrageDialog(prev => ({ ...prev, open: false }));
          setIsSubmitting(true);
          try {
            // Record demurrage payment
            const { data: paymentRecord, error: paymentError } = await supabase
              .from('demurrage_payments')
              .insert({
                container_number: containerNumber,
                shipping_line: formData.shippingLine,
                chargeable_days: chargeableDays,
                demurrage_amount: demurrageAmount,
                handling_fee: HANDLING_FEE,
                total_collected: totalCollected,
                collected_by: user!.id,
              })
              .select()
              .single();

            if (paymentError) throw paymentError;

            // Print demurrage receipt
            printDemurrageReceipt({
              id: paymentRecord.id,
              containerNumber,
              shippingLine: formData.shippingLine,
              chargeableDays,
              demurrageAmount,
              handlingFee: HANDLING_FEE,
              totalCollected,
            });

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