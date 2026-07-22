import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container, AlertTriangle, Building2 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { GateInData } from "@/types/container";
import type { DemurragePaymentData, PortLookupData } from "@/types/gateIn";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateInSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import DemurrageCollectionDialog, { getServiceFeeConfig } from "@/components/DemurrageCollectionDialog";
import { logActivity } from "@/lib/activityLog";
import { printGateInReceipt } from "@/lib/gateInReceipt";
import { GateMotionOverlay } from "@/components/GateMotionOverlay";
import { useYards } from "@/hooks/useYards";
import { SHIPPING_LINES } from "@/lib/shippingLines";
import type { ShippingLine } from "@/lib/shippingLines";
import { CONTAINER_TYPES } from "@/lib/containerTypes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContainerLookup } from "@/hooks/useContainerLookup";
import { usePendingGateIns } from "@/hooks/usePendingGateIns";
import { GateInStepper } from "@/components/gate-in/GateInStepper";
import { PendingGateInsCard } from "@/components/gate-in/PendingGateInsCard";
import { DemurragePreviewCard } from "@/components/gate-in/DemurragePreviewCard";
import { DemurrageTierRulesTable } from "@/components/gate-in/DemurrageTierRulesTable";
import {
  calculateDemurrage,
  hasDemurrageRules,
  isDemurrageSettledForTrip,
  firstGateInOfTrip,
  DEMURRAGE_RULES,
} from "@/lib/demurrage";

const EMPTY_FORM: GateInData = {
  containerNumber: "",
  containerType: "",
  shippingLine: "SLD",
  driverName: "",
  truckNumber: "",
  portArrivalDate: "",
  freeDays: "",
  dailyDemurrage: "",
  yardBlock: "",
  yardRow: "",
};

const GateIn = () => {
  const { user, currentYardId, profile, isSuperAdmin, selectedYardId, setSelectedYardId } = useAuth();
  const { yards } = useYards();
  const { toast } = useToast();
  const [formData, setFormData] = useState<GateInData>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gateMotion, setGateMotion] = useState<string | null>(null);
  const [demurrageDialog, setDemurrageDialog] = useState<{
    open: boolean;
    chargeableDays: number;
    demurrageAmount: number;
    containerNumber: string;
  }>({ open: false, chargeableDays: 0, demurrageAmount: 0, containerNumber: "" });

  // Auto-fill / clear port fields when the lookup resolves.
  const handlePortData = (data: PortLookupData | null) => {
    if (data) {
      setFormData(prev => ({
        ...prev,
        portArrivalDate: data.port_arrival_date,
        freeDays: String(data.free_days),
        dailyDemurrage: String(data.daily_demurrage),
        shippingLine: data.shipping_line as ShippingLine,
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        portArrivalDate: "",
        freeDays: "",
        dailyDemurrage: "",
      }));
    }
  };

  const {
    portDataFound,
    lookupDone,
    lastDemurragePaymentAt,
    setLastDemurragePaymentAt,
    alreadyInYard,
    setAlreadyInYard,
    gateInTimes,
    inspectionStatus,
    reset: resetLookup,
  } = useContainerLookup(formData.containerNumber, currentYardId, handlePortData);

  // Trip scoping: the port arrival date on file anchors the CURRENT trip.
  // A payment or gate-in from before it belongs to a previous visit cycle,
  // so a returning container is charged fresh demurrage for its new trip.
  const demurrageAlreadyPaid = isDemurrageSettledForTrip(
    lastDemurragePaymentAt,
    formData.portArrivalDate || null,
  );
  const tripGateIn = useMemo(
    () => firstGateInOfTrip(gateInTimes, formData.portArrivalDate || null),
    [gateInTimes, formData.portArrivalDate],
  );

  const { pendingGateIns, reload: reloadPending } = usePendingGateIns(currentYardId);

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

  // Tiered demurrage calculation — capped at this trip's first gate-in so
  // demurrage stops accruing once the container has been picked up from the port.
  const demurragePreview = useMemo(() => {
    if (!formData.portArrivalDate || !formData.containerType) return null;
    const asOf = tripGateIn ?? new Date();
    return calculateDemurrage(
      formData.shippingLine,
      formData.containerType,
      formData.portArrivalDate,
      asOf,
    );
  }, [
    formData.portArrivalDate,
    formData.containerType,
    formData.shippingLine,
    tripGateIn,
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

  const isInspectionRejected = inspectionStatus?.status === "rejected";
  // Gate-in requires a fresh, approved inspection on file for this trip —
  // an operator can no longer type an uninspected container straight into
  // this form and complete the gate-in. Only "approved" clears the gate.
  const isInspectionApproved = inspectionStatus?.status === "approved";
  const inspectionBlocksGateIn = lookupDone && !isInspectionApproved;

  // Port data is "complete enough" to gate in as long as arrival date is set and not in the future.
  const portDataComplete =
    !!formData.portArrivalDate && !portArrivalIsFuture;

  const showNoPortDataWarning = lookupDone && !portDataFound;

  const clearForm = () => {
    setFormData(EMPTY_FORM);
    resetLookup();
  };

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

    if (!formData.yardBlock.trim() || !formData.yardRow.trim()) {
      toast({
        title: "Yard Slot Required",
        description: "Enter both the yard block and row where the container will be placed.",
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

      // 1) Block double gate-in: if this container has an open visit anywhere,
      //    refuse before doing anything else (so we never re-prompt for payment).
      const { data: masterCheck } = await supabase
        .from("containers")
        .select("id")
        .eq("container_number", containerNumber)
        .maybeSingle();

      if (masterCheck?.id) {
        const { data: openVisit } = await supabase
          .from("container_visits")
          .select("id")
          .eq("container_id", masterCheck.id)
          .is("gate_out_time", null)
          .maybeSingle();
        if (openVisit) {
          toast({
            title: "Container Already In Yard",
            description: "This container is already gated in. Gate it out before gating in again.",
            variant: "destructive",
          });
          setAlreadyInYard(true);
          setIsSubmitting(false);
          return;
        }
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

  const insertContainer = async (containerNumber: string, demurragePayment?: DemurragePaymentData) => {
    const yardId = currentYardId();
    if (!yardId) throw new Error("No yard assigned to your account");

    // 1) Upsert master container row (unique on container_number).
    let masterId: string | null = null;
    const { data: existingMaster } = await supabase
      .from("containers")
      .select("id")
      .eq("container_number", containerNumber)
      .maybeSingle();

    if (existingMaster?.id) {
      masterId = existingMaster.id;
      // Keep type/line current in case they've changed.
      await supabase
        .from("containers")
        .update({
          container_type: formData.containerType,
          shipping_line: formData.shippingLine,
        })
        .eq("id", masterId);
    } else {
      const { data: newMaster, error: masterErr } = await supabase
        .from("containers")
        .insert({
          container_number: containerNumber,
          container_type: formData.containerType,
          shipping_line: formData.shippingLine,
        })
        .select("id")
        .single();
      if (masterErr) throw masterErr;
      masterId = newMaster.id;
    }

    // 2) Guard against a concurrent open visit.
    const { data: openVisit } = await supabase
      .from("container_visits")
      .select("id")
      .eq("container_id", masterId!)
      .is("gate_out_time", null)
      .maybeSingle();
    if (openVisit) {
      toast({
        title: "Container Already In Yard",
        description: "This container is already gated in.",
        variant: "destructive",
      });
      return;
    }

    // 3) Insert a new visit.
    const { data: visit, error } = await supabase
      .from("container_visits")
      .insert({
        container_id: masterId!,
        yard_id: yardId,
        status: "in-yard",
        driver_name: formData.driverName,
        truck_number: formData.truckNumber,
        yard_block: formData.yardBlock || null,
        yard_row: formData.yardRow || null,
        port_arrival_date: formData.portArrivalDate || null,
        free_days: formData.freeDays ? parseInt(formData.freeDays, 10) : 7,
        daily_demurrage: formData.dailyDemurrage
          ? parseFloat(formData.dailyDemurrage)
          : null,
        created_by: user!.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Best-effort activity log
    await logActivity({
      userId: user!.id,
      yardId,
      action: "gate_in",
      containerId: visit.id,
      containerNumber,
      metadata: {
        block: formData.yardBlock || null,
        row: formData.yardRow || null,
        demurrage_collected_jod: demurragePayment?.totalCollected ?? 0,
      },
    });

    toast({
      title: "Success",
      description: `Container ${containerNumber} gated in successfully`,
    });
    setGateMotion(containerNumber);

    const printed = printGateInReceipt(
      {
        id: visit.id,
        ticket_number: visit.ticket_number,
        container_number: containerNumber,
        container_type: formData.containerType,
        shipping_line: formData.shippingLine,
        driver_name: formData.driverName,
        truck_number: formData.truckNumber,
        gate_in_time: visit.gate_in_time,
      },
      demurragePayment,
      inspectionStatus,
      profile,
    );
    if (!printed) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-in receive note.",
        variant: "destructive",
      });
    }

    clearForm();
    reloadPending();
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 animate-in fade-in-0 duration-300">
      {gateMotion && (
        <GateMotionOverlay
          direction="in"
          containerNumber={gateMotion}
          onDone={() => setGateMotion(null)}
        />
      )}
      <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader icon={Container} title="Gate In Container" subtitle="Record container arrivals and collect demurrage" />

      {isSuperAdmin() && !selectedYardId ? (
        <Alert className="border-warning/40 bg-warning/10">
          <Building2 className="h-4 w-4" />
          <AlertTitle>Select a yard to gate in containers</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              You're viewing "All yards." Gate-in (and the approved-inspection
              queue below) needs one specific yard selected — pick one:
            </p>
            <Select value={selectedYardId ?? undefined} onValueChange={(v) => setSelectedYardId(v)}>
              <SelectTrigger className="w-full max-w-xs bg-background">
                <SelectValue placeholder="Choose a yard…" />
              </SelectTrigger>
              <SelectContent>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AlertDescription>
        </Alert>
      ) : (
        <>
      <PendingGateInsCard
        items={pendingGateIns}
        onSelect={(containerNumber) =>
          setFormData((prev) => ({ ...prev, containerNumber }))
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Container Entry Information</CardTitle>
          {/* ── Step progress indicator ──────────────────── */}
          <GateInStepper
            step1Done={lookupDone && formData.containerNumber.length >= 4}
            step2Done={
              lookupDone &&
              formData.containerNumber.length >= 4 &&
              (demurrageAlreadyPaid || !portDataFound || (demurragePreview?.totalJOD ?? 0) === 0)
            }
            step3Done={!!formData.driverName && !!formData.truckNumber}
          />
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
                  placeholder="e.g., MSKU1234567"
                  maxLength={11}
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
                    {CONTAINER_TYPES.map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                    ))}
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

              <div className="space-y-2">
                <Label htmlFor="yardBlock">Yard Block *</Label>
                <Input
                  id="yardBlock"
                  value={formData.yardBlock}
                  onChange={(e) => setFormData({ ...formData, yardBlock: e.target.value.toUpperCase() })}
                  placeholder="e.g., A"
                  className="font-mono"
                  maxLength={8}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="yardRow">Yard Row *</Label>
                <Input
                  id="yardRow"
                  value={formData.yardRow}
                  onChange={(e) => setFormData({ ...formData, yardRow: e.target.value.toUpperCase() })}
                  placeholder="e.g., 03"
                  className="font-mono"
                  maxLength={8}
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
                    <DemurragePreviewCard preview={demurragePreview} />
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
                    <DemurrageTierRulesTable
                      shippingLine={formData.shippingLine}
                      containerType={formData.containerType}
                    />
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

              {lookupDone && !alreadyInYard && (
                <div className={`mt-4 p-3 rounded-md border text-sm ${
                  isInspectionApproved
                    ? "bg-green-50 border-green-300 text-green-700"
                    : inspectionStatus?.status === "rejected"
                      ? "bg-red-50 border-red-300 text-red-700"
                      : inspectionStatus?.status === "pending"
                        ? "bg-red-50 border-red-300 text-red-700"
                        : "bg-red-50 border-red-300 text-red-700"
                }`}>
                  {!inspectionStatus && "❌ No inspection on file for this trip — this container must be inspected and approved before it can be gated in."}
                  {isInspectionApproved && `✅ Inspection Approved — Grade ${inspectionStatus.grade}`}
                  {inspectionStatus?.status === "pending"  && "❌ Inspection Pending — waiting on the inspector's decision before this can be gated in."}
                  {inspectionStatus?.status === "rejected" && "❌ Inspection Rejected — this container cannot be gated in."}
                </div>
              )}

              {!alreadyInYard && demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
                  ✅ Demurrage already paid for this container — no further collection required.
                </div>
              )}

              {!demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (() => {
                const feeCfg = getServiceFeeConfig(formData.shippingLine);
                return (
                <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm space-y-3">
                  <p className="font-medium">⚠️ Demurrage Due — Collect payment before gate-in</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span>Demurrage Total</span><strong>{demurragePreview.totalJOD.toLocaleString()} JOD</strong></div>
                    <div className="flex justify-between"><span>Service Fee</span><strong>{feeCfg.total} JOD</strong></div>
                    <div className="flex justify-between border-t border-red-200 pt-1 text-sm"><span className="font-semibold">Total to Collect</span><strong>{(demurragePreview.totalJOD + feeCfg.total).toLocaleString()} JOD</strong></div>
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
                );
              })()}
            </div>

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={clearForm}
              >
                Clear Form
              </Button>
              <Button
                type="submit"
                className="bg-maritime hover:bg-maritime/90"
                disabled={isSubmitting || hasDemurrageDue || alreadyInYard || !portDataComplete || inspectionBlocksGateIn}
              >
                {isSubmitting
                  ? "Processing..."
                  : alreadyInYard
                    ? "Already In Yard — Cannot Gate In"
                    : isInspectionRejected
                      ? "Inspection Rejected — Cannot Gate In"
                      : inspectionBlocksGateIn
                        ? "Awaiting Approved Inspection"
                        : hasDemurrageDue
                          ? "Demurrage Due — Collect Payment First"
                          : !formData.portArrivalDate
                            ? "Enter Port Arrival Date"
                            : portArrivalIsFuture
                              ? "Invalid Port Arrival Date"
                              : "Gate In & Print Receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
        </>
      )}
      </div>

      <DemurrageCollectionDialog
        open={demurrageDialog.open}
        shippingLine={formData.shippingLine}
        onClose={() => setDemurrageDialog(prev => ({ ...prev, open: false }))}
        onCollected={async (paymentMethod: "cash" | "qlick") => {
          const { containerNumber, chargeableDays, demurrageAmount } = demurrageDialog;
          const feeCfg = getServiceFeeConfig(formData.shippingLine);
          const totalCollected = demurrageAmount + feeCfg.total;
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
                handling_fee: feeCfg.total,
                total_collected: totalCollected,
                collected_by: user!.id,
                service_fee: feeCfg.total,
                yard_share: feeCfg.yard,
                shipping_line_share: feeCfg.shippingLine,
                payment_method: paymentMethod,
                yard_id: yardIdPay,
              })
              .select()
              .single();

            if (paymentError) throw paymentError;

            // Activity log: demurrage collected
            await logActivity({
              userId: user!.id,
              yardId: yardIdPay,
              action: "demurrage_collected",
              containerNumber,
              metadata: {
                total_collected_jod: totalCollected,
                payment_method: paymentMethod,
                chargeable_days: chargeableDays,
              },
            });

            // Mark paid so banner won't reappear before the next lookup refresh
            setLastDemurragePaymentAt(new Date());

            await insertContainer(containerNumber, {
              id: paymentRecord.id,
              chargeableDays,
              demurrageAmount,
              serviceFee: feeCfg.total,
              totalCollected,
              paymentMethod,
            });
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
