import { useState, useEffect, useMemo } from "react";
import { DateInput } from "@/components/DateInput";
import { toIsoDay } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container, AlertTriangle, Building2, Lock, Unlock } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { GateInData } from "@/types/container";
import type { DemurragePaymentData, PendingGateIn, PortLookupData } from "@/types/gateIn";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateInSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import DemurrageCollectionDialog, { getServiceFeeConfig } from "@/components/DemurrageCollectionDialog";
import { logActivity } from "@/lib/activityLog";
import { ReasonDialog } from "@/components/accounting/ReasonDialog";
import { fmtDay } from "@/components/port-data/format";
import { cancelInspection } from "@/lib/inspections";
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

/**
 * Database checks (the port-list guard, the inspection rule) raise messages
 * written for the operator; anything else gets the generic retry text.
 */
const gateInErrorMessage = (error: unknown): string => {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "23514" && e.message) return e.message; // check_violation
  return "Failed to gate in container. Please try again.";
};

/** "20" / "40" / "45" — the length that sets the demurrage rate column. */
const sizeOf = (type: string | null | undefined) => (type ?? "").slice(0, 2);

const GateIn = () => {
  const { user, currentYardId, profile, isAdmin, isSuperAdmin, selectedYardId, setSelectedYardId } = useAuth();
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

  // The container's entry on its line's port list, when it has one. Its arrival
  // date, free days, line and size are what gets charged, so they're locked;
  // only an admin can override them, with a reason that goes in the log. The
  // database enforces the same lock (container_visits_port_list_guard).
  const [listData, setListData] = useState<PortLookupData | null>(null);
  const [override, setOverride] = useState<{ reason: string } | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);

  const applyListData = (data: PortLookupData) =>
    setFormData(prev => ({
      ...prev,
      portArrivalDate: data.port_arrival_date,
      freeDays: String(data.free_days),
      dailyDemurrage: String(data.daily_demurrage),
      shippingLine: data.shipping_line as ShippingLine,
      // The list's size is what demurrage bills against. A type already picked
      // (usually the inspector's) is kept when it's the same length, since it's
      // the more precise code (20RF rather than 20GP).
      ...(data.container_type && sizeOf(prev.containerType) !== sizeOf(data.container_type)
        ? { containerType: data.container_type }
        : {}),
    }));

  // Auto-fill / clear port fields when the lookup resolves.
  const handlePortData = (data: PortLookupData | null) => {
    setListData(data);
    setOverride(null);
    if (data) {
      applyListData(data);
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

  // The inspector records the container's ISO type at the container itself, so
  // a number typed by hand (rather than tapped from the queue) fills the type
  // too. Only ever into an empty field: port data, when there is any, is what
  // the size-aware demurrage bills against and must not be overwritten.
  // A port list's size of the same length doesn't override it either: the
  // inspector's code is the more precise one.
  useEffect(() => {
    const inspected = inspectionStatus?.container_type;
    if (!inspected) return;
    setFormData((prev) =>
      !prev.containerType || (prev.containerType !== inspected && sizeOf(prev.containerType) === sizeOf(inspected))
        ? { ...prev, containerType: inspected }
        : prev,
    );
  }, [inspectionStatus]);

  const lineRule = hasDemurrageRules(formData.shippingLine) ? DEMURRAGE_RULES[formData.shippingLine] : null;
  // A list entry whose trip already came and went (gated in since that arrival,
  // and out again) is stale — this is a new trip, so it's treated as unlisted.
  // The database guard applies the same rule.
  const listTripDone =
    portDataFound &&
    listData != null &&
    !alreadyInYard &&
    firstGateInOfTrip(gateInTimes, listData.port_arrival_date) != null;
  const onList = portDataFound && listData != null && !listTripDone;
  const listLocked = onList && !override;
  // Free days: the port list's, else the line's standard. Only an admin
  // override can set another figure.
  const typedFreeDays = Number.parseInt(formData.freeDays, 10);
  const effectiveFreeDays =
    override && !Number.isNaN(typedFreeDays) && typedFreeDays >= 0
      ? typedFreeDays
      : onList
        ? listData.free_days
        : lineRule?.freeDays ?? 7;
  // The inspection recorded a different length than the line's list.
  const listSizeConflict =
    onList &&
    !!listData.container_type &&
    !!inspectionStatus?.container_type &&
    sizeOf(inspectionStatus.container_type) !== sizeOf(listData.container_type);

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
      effectiveFreeDays,
    );
  }, [
    formData.portArrivalDate,
    formData.containerType,
    formData.shippingLine,
    tripGateIn,
    effectiveFreeDays,
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
  // Yard/super admins are exempt from the inspection gate (matching the DB
  // container_visits_insert policy) — their manual path is the intended
  // override for corrections and backfills. Operators still require approval.
  const canOverrideInspection = isAdmin() || isSuperAdmin();
  const inspectionBlocksGateIn = lookupDone && !isInspectionApproved && !canOverrideInspection;
  // True when an admin is proceeding without a fresh approved inspection.
  const inspectionAdminOverride =
    lookupDone && !isInspectionApproved && canOverrideInspection;

  // Voiding a mistaken inspection. An approval typed against a wrong container
  // number can never be gated in, so without this it sits in the queue forever.
  const handleCancelInspection = async (item: PendingGateIn, reason: string) => {
    const yardId = currentYardId();
    if (!user || !yardId) return;
    const { ok, error } = await cancelInspection({
      checkId: item.id,
      reason,
      userId: user.id,
      yardId,
      containerNumber: item.container_number,
    });
    if (!ok) {
      toast({ title: "Could not cancel", description: error, variant: "destructive" });
      return;
    }
    toast({
      title: "Inspection cancelled",
      description: `${item.container_number} removed from the gate-in queue.`,
    });
    await reloadPending();
  };

  // Lines with no tiered demurrage formula (e.g. 7Seas, Gezairi) aren't
  // charged, so they need no port data to gate in. Formula lines still require a
  // valid, non-future arrival date to anchor the demurrage clock.
  const lineChargesDemurrage = hasDemurrageRules(formData.shippingLine);
  const portDataComplete =
    !lineChargesDemurrage || (!!formData.portArrivalDate && !portArrivalIsFuture);

  const showNoPortDataWarning = lookupDone && !portDataFound && lineChargesDemurrage;

  // Whether this line has sent a port list at all — then a container missing
  // from it is worth a warning, not just a note.
  const { data: lineHasList = false } = useQuery({
    queryKey: ["container_port_data", "line-has-list", formData.shippingLine, currentYardId() ?? "all"],
    enabled: lineChargesDemurrage,
    queryFn: async () => {
      let q = supabase
        .from("container_port_data")
        .select("container_number")
        .eq("shipping_line", formData.shippingLine);
      const yardId = currentYardId();
      if (yardId) q = q.eq("yard_id", yardId);
      const { data, error } = await q.limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });

  // Clear the stale list's values so this trip's arrival date gets entered.
  useEffect(() => {
    if (listTripDone) setFormData((prev) => ({ ...prev, portArrivalDate: "", freeDays: "" }));
  }, [listTripDone]);

  const startOverride = async (reason: string) => {
    setOverride({ reason });
    setFormData((prev) => ({ ...prev, freeDays: String(effectiveFreeDays) }));
    setOverrideDialogOpen(false);
  };

  const undoOverride = () => {
    setOverride(null);
    if (listData) applyListData(listData);
  };

  const clearForm = () => {
    setFormData(EMPTY_FORM);
    setListData(null);
    setOverride(null);
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

    if (hasDemurrageRules(formData.shippingLine) && !formData.portArrivalDate) {
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
        description: gateInErrorMessage(error),
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
      // Keep type/line current in case they've changed. The port-list guard on
      // the visit insert checks these, so a failed update must not pass silently.
      const { error: masterUpdateErr } = await supabase
        .from("containers")
        .update({
          container_type: formData.containerType,
          shipping_line: formData.shippingLine,
        })
        .eq("id", masterId);
      if (masterUpdateErr) throw masterUpdateErr;
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
        free_days: effectiveFreeDays,
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
        on_port_list: onList,
      },
    });

    // An admin override of the port list is logged field by field with its reason.
    if (override) {
      const before = {
        port_arrival_date: listData?.port_arrival_date ?? null,
        free_days: listData?.free_days ?? lineRule?.freeDays ?? null,
        shipping_line: listData?.shipping_line ?? null,
        container_type: listData?.container_type ?? null,
      };
      const after = {
        port_arrival_date: formData.portArrivalDate || null,
        free_days: effectiveFreeDays,
        shipping_line: formData.shippingLine,
        container_type: formData.containerType,
      };
      const changes = (Object.keys(before) as (keyof typeof before)[])
        .filter((k) => before[k] != null && before[k] !== after[k])
        .map((field) => ({ field, from: before[field], to: after[field] }));
      if (changes.length > 0) {
        await logActivity({
          userId: user!.id,
          yardId,
          action: "port_list_overridden",
          containerId: visit.id,
          containerNumber,
          metadata: { changes, reason: override.reason, on_port_list: onList, visit_id: visit.id },
        });
      }
    }

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
        onSelect={(item) =>
          setFormData((prev) => ({
            ...prev,
            containerNumber: item.container_number,
            // The inspector recorded the type at the container; port data (if
            // any) still overrides it when the lookup lands, since that value
            // is what the size-aware demurrage bills against.
            containerType: item.container_type ?? prev.containerType,
          }))
        }
        canCancel={canOverrideInspection}
        onCancel={handleCancelInspection}
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
                    {CONTAINER_TYPES
                      // While locked to the port list, only types of the list's length.
                      .filter((t) => !listLocked || !listData?.container_type || sizeOf(t.code) === sizeOf(listData.container_type))
                      .map((t) => (
                        <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {listSizeConflict && !override && (
                  <p className="text-xs text-warning">
                    The inspection recorded {inspectionStatus?.container_type}, but {listData?.shipping_line}&rsquo;s port list says {sizeOf(listData?.container_type)}ft. Demurrage follows the list; an admin can override it if the list is wrong.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="shippingLine">Shipping Line *</Label>
                <Select
                  value={formData.shippingLine}
                  onValueChange={(value) => setFormData({ ...formData, shippingLine: value as ShippingLine })}
                  disabled={listLocked}
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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Port & Demurrage Information
                  {onList && !override && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-success font-normal">
                      <Lock className="h-3 w-3" /> From {listData?.shipping_line}&rsquo;s port list
                    </span>
                  )}
                </h3>
                {canOverrideInspection && lookupDone && lineChargesDemurrage && (
                  override ? (
                    <Button type="button" variant="outline" size="sm" onClick={undoOverride}>
                      {onList ? "Use port list values" : "Use standard free days"}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setOverrideDialogOpen(true)}>
                      <Unlock className="h-3.5 w-3.5 mr-1" /> Admin override
                    </Button>
                  )
                )}
              </div>

              {override && (
                <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                  <Unlock className="h-4 w-4" />
                  <AlertTitle>Admin override</AlertTitle>
                  <AlertDescription>
                    {onList ? "Port list values are unlocked" : "Free days are unlocked"}. Any change is logged with your reason: &ldquo;{override.reason}&rdquo;.
                  </AlertDescription>
                </Alert>
              )}

              {listTripDone && lineChargesDemurrage && (
                <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>The port list entry is from an earlier trip</AlertTitle>
                  <AlertDescription>
                    {listData?.shipping_line}&rsquo;s list has this container arriving {fmtDay(listData?.port_arrival_date)}, but it has already been gated in and out since then.
                    Check the new arrival date with {formData.shippingLine} and enter it below.
                  </AlertDescription>
                </Alert>
              )}

              {showNoPortDataWarning && (
                lineHasList ? (
                  <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      {formData.containerNumber.trim().toUpperCase()} isn&rsquo;t on {formData.shippingLine}&rsquo;s port list
                    </AlertTitle>
                    <AlertDescription>
                      Check with {formData.shippingLine} before accepting it. If they confirm, enter the port arrival date below —
                      demurrage uses {formData.shippingLine}&rsquo;s standard {lineRule?.freeDays} free days.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>No port data found for this container</AlertTitle>
                    <AlertDescription>
                      Enter the port arrival date below. Demurrage will be calculated automatically from the shipping line's tier rules. You can still proceed with gate-in.
                    </AlertDescription>
                  </Alert>
                )
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
                      <DateInput
                        id="portArrivalDate"
                        value={formData.portArrivalDate}
                        onChange={(v) => setFormData({ ...formData, portArrivalDate: v })}
                        max={toIsoDay(new Date())}
                        disabled={listLocked}
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
                        value={override ? formData.freeDays : String(effectiveFreeDays)}
                        onChange={(e) => setFormData({ ...formData, freeDays: e.target.value })}
                        disabled={!override}
                      />
                      {lineRule && (
                        <p className="text-xs text-muted-foreground">
                          {onList
                            ? `From the port list · ${formData.shippingLine} standard: ${lineRule.freeDays} days`
                            : `${formData.shippingLine} standard: ${lineRule.freeDays} days`}
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
                      disabled={listLocked}
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
                      freeDays={effectiveFreeDays}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No tier rules configured for {formData.shippingLine}.
                    </p>
                  )}
                </TabsContent>
              </Tabs>

              {alreadyInYard && (
                <div className="mt-4 p-3 bg-warning/10 border border-warning/30 rounded-md text-warning text-sm">
                  This container is already in the yard. It must be gated out before it can be gated in again.
                </div>
              )}

              {lookupDone && !alreadyInYard && (
                <div className={`mt-4 p-3 rounded-md border text-sm ${
                  isInspectionApproved
                    ? "bg-success/10 border-success/30 text-success"
                    : inspectionAdminOverride
                      ? "bg-warning/10 border-warning/30 text-warning"
                      : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}>
                  {isInspectionApproved && `✅ Inspection Approved — Grade ${inspectionStatus.grade}`}

                  {!isInspectionApproved && !inspectionStatus && (canOverrideInspection
                    ? "⚠️ Admin override — no inspection on file for this trip. You can gate in without a fresh inspection."
                    : "❌ No inspection for this trip. If this container was previously gated out, ask the inspector to re-inspect it (Inspector app → enter the container number) before gate-in.")}

                  {!isInspectionApproved && inspectionStatus?.status === "pending" && (canOverrideInspection
                    ? "⚠️ Admin override — inspection still pending. You can gate in without a final decision."
                    : "❌ Inspection Pending — waiting on the inspector's decision before this can be gated in.")}

                  {!isInspectionApproved && inspectionStatus?.status === "rejected" && (canOverrideInspection
                    ? "⚠️ Admin override — this container's inspection was REJECTED. Gating it in anyway."
                    : "❌ Inspection Rejected — this container cannot be gated in.")}
                </div>
              )}

              {!alreadyInYard && demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (
                <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded-md text-success text-sm">
                  Demurrage already paid for this container — no further collection required.
                </div>
              )}

              {!demurrageAlreadyPaid && demurragePreview && demurragePreview.totalJOD > 0 && (() => {
                const feeCfg = getServiceFeeConfig(formData.shippingLine);
                return (
                <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-sm space-y-3">
                  <p className="font-medium">Demurrage Due — Collect payment before gate-in</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span>Demurrage Total</span><strong>{demurragePreview.totalJOD.toLocaleString()} JOD</strong></div>
                    <div className="flex justify-between"><span>Service Fee</span><strong>{feeCfg.total} JOD</strong></div>
                    <div className="flex justify-between border-t border-destructive/20 pt-1 text-sm"><span className="font-semibold">Total to Collect</span><strong>{(demurragePreview.totalJOD + feeCfg.total).toLocaleString()} JOD</strong></div>
                  </div>
                  <Button
                    type="button"
                    className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground"
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
                    : inspectionBlocksGateIn
                      ? (isInspectionRejected
                          ? "Inspection Rejected — Cannot Gate In"
                          : "Awaiting Approved Inspection")
                      : hasDemurrageDue
                        ? "Demurrage Due — Collect Payment First"
                        : !formData.portArrivalDate
                          ? "Enter Port Arrival Date"
                          : portArrivalIsFuture
                            ? "Invalid Port Arrival Date"
                            : inspectionAdminOverride
                              ? "Gate In (Admin Override) & Print"
                              : "Gate In & Print Receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
        </>
      )}
      </div>

      <ReasonDialog
        open={overrideDialogOpen}
        title="Override port data"
        description={
          onList
            ? `Unlock the arrival date, free days, line and size that ${listData?.shipping_line}'s port list sets for this container. What you change is logged with this reason.`
            : "Unlock the free days for this container. What you change is logged with this reason."
        }
        confirmLabel="Unlock"
        destructive
        onCancel={() => setOverrideDialogOpen(false)}
        onConfirm={startOverride}
      />

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
                // The yard keeps the service fee; the demurrage is collected on
                // the shipping line's behalf and owed onward in full.
                yard_share: feeCfg.total,
                shipping_line_share: demurrageAmount,
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
              description: gateInErrorMessage(error),
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
