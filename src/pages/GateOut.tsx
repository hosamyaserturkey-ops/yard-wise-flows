import { useCallback, useState, useEffect } from "react";
import { escapeHtml } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Ship, Search } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateOutSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import { logActivity } from "@/lib/activityLog";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";

const GateOut = () => {
  const { user, profile, currentYardId } = useAuth();
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [bookingNumber, setBookingNumber] = useState("");
  const [fees, setFees] = useState("");
  const [driverName, setDriverName] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch containers in yard
  const fetchContainers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('container_visits')
        .select(VISIT_WITH_CONTAINER)
        .in('status', ['reserved', 'in-yard'])
        .is('gate_out_time', null)
        .order('gate_in_time', { ascending: false });

      if (error) throw error;

      const formattedContainers: ContainerType[] = (data ?? []).map((row) =>
        mapVisit(row as unknown as VisitJoinRow)
      );

      setContainers(formattedContainers);
    } catch (error) {
      console.error('Error fetching containers:', error);
      toast({
        title: "Error",
        description: "Failed to load containers. Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);


  const filteredContainers = containers.filter(container =>
    container.containerNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.truckNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleContainerSelect = (container: ContainerType) => {
    setSelectedContainer(container);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate with zod
    const result = gateOutSchema.safeParse({ driverName, truckNumber, fees });
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    if (!selectedContainer) {
      toast({
        title: "Error",
        description: "Please select a container",
        variant: "destructive",
      });
      return;
    }

    // Verify that the container has a booking number (should be reserved)
    if (!selectedContainer.bookingNumber) {
      toast({
        title: "Error",
        description: "Selected container is not associated with a booking",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to gate out containers.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Close the open visit for this container.
      const { error: containerError } = await supabase
        .from('container_visits')
        .update({
          status: 'out',
          gate_out_time: new Date().toISOString(),
          fees: parseFloat(fees),
          driver_name: driverName,
          truck_number: truckNumber,
          yard_block: null,
          yard_row: null,
        })
        .eq('id', selectedContainer.id);

      if (containerError) throw containerError;

      // Update booking's gated out containers count
      const { error: bookingError } = await supabase.rpc("increment_gated_out_containers", {
        booking_num: selectedContainer.bookingNumber
      });

      if (bookingError) throw bookingError;

      // Activity log
      const yardId = currentYardId();
      if (user && yardId) {
        await logActivity({
          userId: user.id,
          yardId,
          action: "gate_out",
          containerId: selectedContainer.id,
          containerNumber: selectedContainer.containerNumber,
          metadata: {
            booking_number: selectedContainer.bookingNumber,
            fees_jod: parseFloat(fees) || 0,
          },
        });
      }

      toast({
        title: "Success",
        description: `Container ${selectedContainer.containerNumber} gated out successfully`,
      });

      // Print receipt
      printReceipt();

      // Reset form and refresh containers
      setSelectedContainer(null);
      setFees("");
      setDriverName("");
      setTruckNumber("");
      setSearchTerm("");
      fetchContainers();

    } catch (error) {
      console.error('Error gating out container:', error);
      toast({
        title: "Error",
        description: "Failed to gate out container. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const printReceipt = () => {
    if (!selectedContainer) return;

    const receiptWindow = window.open("", "_blank");
    if (!receiptWindow) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-out delivery note.",
        variant: "destructive",
      });
      return;
    }

    const now = new Date();
    const dateStr = escapeHtml(now.toLocaleDateString("en-GB"));
    const timeStr = escapeHtml(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    const ticketNum = String(
      parseInt(selectedContainer.id.replace(/-/g, "").slice(0, 8), 16) % 1000000,
    ).padStart(6, "0");
    const yardName = escapeHtml(profile?.yard_name || "YARD");
    const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
    const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
    const printedAt = escapeHtml(now
      .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .replace(",", ""));

    const ISO_DESCRIPTIONS: Record<string, string> = {
      "20FT": "20FT — 20ft Standard dry container",
      "40FT": "40FT — 40ft Standard dry container",
      "40HC": "40HC — 40ft High Cube dry container",
      "45FT": "45FT — 45ft High Cube dry container",
      "20FR": "20FR — 20ft Reefer container",
      "40FR": "40FR — 40ft Reefer container",
    };
    const isoLabel = escapeHtml(ISO_DESCRIPTIONS[selectedContainer.containerType] || selectedContainer.containerType);
    const gateInStr = escapeHtml(`${selectedContainer.gateInTime.toLocaleDateString("en-GB")} ${selectedContainer.gateInTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`);
    const feeStr = Number(fees || 0).toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const containerNumberSafe = escapeHtml(selectedContainer.containerNumber);
    const shippingLineSafe = escapeHtml(selectedContainer.shippingLine);
    const bookingNumberSafe = escapeHtml(selectedContainer.bookingNumber || "—");
    const truckNumberSafe = escapeHtml(truckNumber);
    const driverNameSafe = escapeHtml(driverName);

    receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Gate-Out Ticket — ${containerNumberSafe}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; color: #1e293b; }
    .page { max-width: 780px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }

    .header { background: #134e4a; color: #fff; padding: 24px 32px 28px; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .logo-text { color: #134e4a; font-weight: 800; font-size: 1.1rem; letter-spacing: 1px; }
    .header-center { text-align: center; flex: 1; padding: 0 24px; }
    .ticket-title { font-size: 1.7rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
    .ticket-title-ar { font-size: 0.9rem; color: #99f6e4; margin-top: 2px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .yard-name { font-size: 1.1rem; font-weight: 700; margin-top: 4px; letter-spacing: 1px; }
    .header-meta { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 10px; font-size: 0.85rem; color: #ccfbf1; }
    .ticket-num-box { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 4px 14px; font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; text-align: center; }
    .sl-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .sl-badge { background: #134e4a; color: #fff; border-radius: 6px; padding: 6px 14px; font-size: 1.1rem; font-weight: 800; letter-spacing: 2px; }
    .right-col { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

    .body { padding: 0 32px 24px; }
    .section { border-bottom: 1px solid #e2e8f0; padding: 20px 0; }
    .section:last-of-type { border-bottom: none; }
    .section-header { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; }
    .field-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.05rem; color: #134e4a; letter-spacing: 1px; }
    .field-wide { grid-column: span 2; }

    .fees-card { background: #ecfeff; border: 1px solid #67e8f9; border-radius: 10px; padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; }
    .fees-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #0e7490; }
    .fees-ar { font-size: 0.75rem; color: #22d3ee; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .fees-amount { font-size: 2rem; font-weight: 800; color: #0e7490; margin-top: 8px; }
    .fees-currency { font-size: 1rem; font-weight: 600; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 24px 32px 20px; border-top: 1px solid #e2e8f0; }
    .sig { text-align: center; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 6px; margin-bottom: 4px; }
    .sig-name { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #134e4a; }
    .sig-name-ar { font-size: 0.72rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.85rem; font-weight: 600; color: #334155; margin-top: 3px; }

    .footer-bar { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 10px 32px; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #94a3b8; }
    .footer-brand { font-weight: 700; color: #475569; }

    /* ── Print: compact everything so the ticket always fits one A4 page ── */
    @page { size: A4 portrait; margin: 8mm; }
    @media print {
      html { font-size: 13px; }
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { box-shadow: none; margin: 0; border-radius: 0; max-width: 100%; }
      .header { padding: 12px 24px 14px; }
      .header-meta { margin-top: 6px; }
      .body { padding: 0 24px 10px; }
      .section { padding: 10px 0; break-inside: avoid; }
      .section-header { margin-bottom: 8px; }
      .fields { gap: 8px 24px; }
      .fees-card { padding: 10px 16px; }
      .fees-amount { font-size: 1.5rem; margin-top: 4px; }
      /* Keep the top padding roomy — it is the blank space people sign in. */
      .signatures { padding: 26px 24px 10px; gap: 16px; break-inside: avoid; }
      .footer-bar { padding: 6px 24px; break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-inner">
      <div class="logo-box"><span class="logo-text">${yardName}</span></div>
      <div class="header-center">
        <div class="ticket-title">Gate-Out Ticket</div>
        <div class="ticket-title-ar">وصل تسليم حاوية</div>
        <div class="yard-name">${yardName}</div>
        <div class="header-meta">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
        </div>
      </div>
      <div class="right-col">
        <div class="ticket-num-box"># ${ticketNum}</div>
        <div class="sl-box"><span class="sl-badge">${shippingLineSafe}</span></div>
      </div>
    </div>
  </div>

  <div class="body">

    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        CONTAINER INFORMATION
      </div>
      <div class="fields">
        <div class="field field-wide">
          <div class="field-label">CONTAINER NUMBER</div>
          <div class="field-value mono">${containerNumberSafe}</div>
        </div>
        <div class="field field-wide">
          <div class="field-label">ISO TYPE / SIZE</div>
          <div class="field-value">${isoLabel}</div>
        </div>
        <div class="field">
          <div class="field-label">SHIPPING LINE</div>
          <div class="field-value">${shippingLineSafe}</div>
        </div>
        <div class="field">
          <div class="field-label">BOOKING NUMBER</div>
          <div class="field-value mono">${bookingNumberSafe}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        TRANSPORT INFORMATION
      </div>
      <div class="fields">
        <div class="field">
          <div class="field-label">TRUCK NUMBER</div>
          <div class="field-value">${truckNumberSafe}</div>
        </div>
        <div class="field">
          <div class="field-label">DRIVER NAME</div>
          <div class="field-value">${driverNameSafe}</div>
        </div>
        <div class="field">
          <div class="field-label">GATE-IN</div>
          <div class="field-value">${gateInStr}</div>
        </div>
        <div class="field">
          <div class="field-label">GATE-OUT</div>
          <div class="field-value">${dateStr} ${timeStr}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        FINANCIAL SUMMARY
      </div>
      <div class="fees-card">
        <div>
          <div class="fees-label">GATE-OUT FEES COLLECTED</div>
          <div class="fees-ar">رسوم الخروج المحصلة</div>
          <div class="fees-amount">${feeStr} <span class="fees-currency">JOD</span></div>
        </div>
        <div>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0e7490" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9"/></svg>
        </div>
      </div>
    </div>

  </div>

  <div class="signatures">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Booking Representative</div>
      <div class="sig-name-ar">ممثل الحجز</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

  <div class="footer-bar">
    <span class="footer-brand">🏗 ${yardName}</span>
    <span>🔒 Official Document — Do not alter</span>
    <span>Printed: ${printedAt} by ${printedBy}</span>
  </div>

</div>
<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 300); };
</script>
</body>
</html>`);
    receiptWindow.document.close();
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading containers...</div>;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader icon={Ship} title="Gate Out" subtitle="Process reserved containers for departure" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Container Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Container to Gate Out</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by container number, driver, or truck..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredContainers.map((container) => (
                <div
                  key={container.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedContainer?.id === container.id
                      ? "border-maritime bg-maritime/5"
                      : "border-border hover:border-maritime/50"
                  }`}
                  onClick={() => handleContainerSelect(container)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-lg">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.containerType} • {container.shippingLine}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                      </div>
                      <div className="text-sm text-blue-600 font-medium">
                        Booking: {container.bookingNumber}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      In yard since:<br />
                      {container.gateInTime.toLocaleDateString()}<br />
                      {container.gateInTime.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              {filteredContainers.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm ? "No containers found matching your search" : "No containers available for gate out"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Gate Out Form */}
        <Card>
          <CardHeader>
            <CardTitle>Gate Out Information</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedContainer ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="p-4 bg-muted rounded-lg">
                  <h3 className="font-medium mb-2">Selected Container</h3>
                  <div className="text-sm space-y-1">
                    <div><span className="font-medium">Container:</span> {selectedContainer.containerNumber}</div>
                    <div><span className="font-medium">Type:</span> {selectedContainer.containerType}</div>
                    <div><span className="font-medium">Line:</span> {selectedContainer.shippingLine}</div>
                    <div><span className="font-medium">Driver:</span> {selectedContainer.driverName}</div>
                    <div><span className="font-medium">Truck:</span> {selectedContainer.truckNumber}</div>
                    <div><span className="font-medium">Booking:</span> {selectedContainer.bookingNumber}</div>
                  </div>
                </div>

                <div className="space-y-4">

                  <div className="space-y-2">
                    <Label htmlFor="driverName">Driver Name *</Label>
                    <Input
                      id="driverName"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Enter driver name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="truckNumber">Truck Number *</Label>
                    <Input
                      id="truckNumber"
                      value={truckNumber}
                      onChange={(e) => setTruckNumber(e.target.value.toUpperCase())}
                      placeholder="Enter truck number"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fees">Total Fees (JOD) *</Label>
                    <Input
                      id="fees"
                      type="number"
                      step="0.01"
                      min="0"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedContainer(null);
                      setFees("");
                      setDriverName("");
                      setTruckNumber("");
                    }}
                  >
                    Clear
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-maritime hover:bg-maritime/90"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Gate Out & Print Receipt"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Please select a container from the list to gate out
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GateOut;