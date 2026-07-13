import { useState, useEffect, useMemo, useCallback } from "react";
import { escapeHtml } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container, AlertTriangle, ClipboardCheck, Check } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { GateInData } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateInSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import DemurrageCollectionDialog, { SERVICE_FEE, YARD_SHARE, SHIPPING_LINE_SHARE, getServiceFeeConfig } from "@/components/DemurrageCollectionDialog";
import { logActivity } from "@/lib/activityLog";
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

interface PendingGateIn {
  container_number: string;
  grade: string;
  notes: string | null;
  inspected_at: string;
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

interface DemurragePaymentData {
  id: string;
  chargeableDays: number;
  demurrageAmount: number;
  serviceFee: number;
  totalCollected: number;
  paymentMethod: string;
}

interface InspectionStatus {
  status: "approved" | "rejected" | "pending";
  grade: string;
}

const GateIn = () => {
  const { user, currentYardId, profile } = useAuth();
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
    yardBlock: "",
    yardRow: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [portDataFound, setPortDataFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [demurrageAlreadyPaid, setDemurrageAlreadyPaid] = useState(false);
  const [alreadyInYard, setAlreadyInYard] = useState(false);
  // Earliest known gate-in date for this container — demurrage stops at this date.
  const [earliestGateIn, setEarliestGateIn] = useState<Date | null>(null);
  const [pendingGateIns, setPendingGateIns] = useState<PendingGateIn[]>([]);
  const [demurrageDialog, setDemurrageDialog] = useState<{
    open: boolean;
    chargeableDays: number;
    demurrageAmount: number;
    containerNumber: string;
  }>({ open: false, chargeableDays: 0, demurrageAmount: 0, containerNumber: "" });
  const [inspectionStatus, setInspectionStatus] = useState<InspectionStatus | null>(null);

  // Debounced lookup of container_port_data when container number changes
  useEffect(() => {
    const containerNum = formData.containerNumber.trim().toUpperCase();
    if (containerNum.length < 4) {
      setPortDataFound(false);
      setLookupDone(false);
      setDemurrageAlreadyPaid(false);
      setAlreadyInYard(false);
      setInspectionStatus(null);
      setEarliestGateIn(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Port data lookup — scoped to the current yard so each yard sees its own row.
      const yardId = currentYardId();
      let query = supabase
        .from("container_port_data")
        .select("port_arrival_date, free_days, daily_demurrage, shipping_line")
        .eq("container_number", containerNum);
      if (yardId) query = query.eq("yard_id", yardId);
      const { data } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
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

      // Already-in-yard check: is there an open visit for this container?
      const { data: masterRow } = await supabase
        .from("containers")
        .select("id")
        .eq("container_number", containerNum)
        .maybeSingle();

      let openVisit: { id: string } | null = null;
      let firstGateIn: { gate_in_time: string } | null = null;
      if (masterRow?.id) {
        const { data: openRow } = await supabase
          .from("container_visits")
          .select("id")
          .eq("container_id", masterRow.id)
          .is("gate_out_time", null)
          .maybeSingle();
        openVisit = openRow ?? null;

        const { data: firstRow } = await supabase
          .from("container_visits")
          .select("gate_in_time")
          .eq("container_id", masterRow.id)
          .order("gate_in_time", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstGateIn = firstRow ?? null;
      }
      setAlreadyInYard(!!openVisit);

      setEarliestGateIn(
        firstGateIn?.gate_in_time ? new Date(firstGateIn.gate_in_time) : null
      );

      // Demurrage already paid: port demurrage is a one-time settlement.
      // Any existing payment for this container means it's already settled.
      const { data: paymentRow } = await supabase
        .from("demurrage_payments")
        .select("id")
        .eq("container_number", containerNum)
        .limit(1)
        .maybeSingle();
      setDemurrageAlreadyPaid(!!paymentRow);

      // Latest inspection check for this container
      const { data: inspectionRow } = await supabase
        .from("inspector_checks")
        .select("status, grade")
        .eq("container_number", containerNum)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setInspectionStatus(
        inspectionRow
          ? { status: inspectionRow.status as InspectionStatus["status"], grade: inspectionRow.grade }
          : null
      );

      setLookupDone(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.containerNumber]);

  // Load and subscribe to approved inspections awaiting gate-in.
  const loadPending = useCallback(async () => {
    const yardId = currentYardId();
    if (!yardId) return;

    // Latest inspection per container
    const { data: checks } = await supabase
      .from("inspector_checks")
      .select("container_number, grade, status, notes, created_at")
      .eq("yard_id", yardId)
      .order("created_at", { ascending: false });

    // Containers currently in yard (open visits) — used to exclude from queue.
    const { data: inYardRows } = await supabase
      .from("container_visits")
      .select("containers!inner(container_number)")
      .eq("yard_id", yardId)
      .is("gate_out_time", null);

    const inYardSet = new Set(
      (inYardRows ?? []).map((r: { containers: { container_number: string } | null }) =>
        r.containers?.container_number ?? ""
      )
    );

    // Keep latest check per container, then filter approved + not in yard
    const latestPerContainer = new Map<string, typeof checks extends null ? never : (typeof checks)[number]>();
    for (const c of checks || []) {
      if (!latestPerContainer.has(c.container_number)) {
        latestPerContainer.set(c.container_number, c);
      }
    }

    setPendingGateIns(
      Array.from(latestPerContainer.values())
        .filter((c) => c.status === "approved" && !inYardSet.has(c.container_number))
        .map((c) => ({
          container_number: c.container_number,
          grade: c.grade,
          notes: c.notes,
          inspected_at: c.created_at,
        }))
    );
  }, [currentYardId]);

  useEffect(() => {
    loadPending();
    const channel = supabase
      .channel("inspector_checks_pending")
      .on("postgres_changes", { event: "*", schema: "public", table: "inspector_checks" }, loadPending)
      .on("postgres_changes", { event: "*", schema: "public", table: "container_visits" }, loadPending)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPending]);

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

  // Tiered demurrage calculation — capped at the earliest known gate-in date so
  // demurrage stops accruing once the container has been picked up from the port.
  const demurragePreview = useMemo(() => {
    if (!formData.portArrivalDate || !formData.containerType) return null;
    const asOf = earliestGateIn ?? new Date();
    const result = calculateDemurrage(
      formData.shippingLine,
      formData.containerType,
      formData.portArrivalDate,
      asOf,
    );
    return result;
  }, [
    formData.portArrivalDate,
    formData.containerType,
    formData.shippingLine,
    earliestGateIn,
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

    printReceipt(
      {
        id: visit.id,
        container_number: containerNumber,
        container_type: formData.containerType,
        shipping_line: formData.shippingLine,
        driver_name: formData.driverName,
        truck_number: formData.truckNumber,
        gate_in_time: visit.gate_in_time,
      },
      demurragePayment,
      inspectionStatus,
    );

    setFormData({
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
    });
    setPortDataFound(false);
    setLookupDone(false);
    setDemurrageAlreadyPaid(false);
    setAlreadyInYard(false);
    setInspectionStatus(null);
    setEarliestGateIn(null);
    loadPending();
  };

  const printReceipt = (
    containerData: InsertedContainerRow,
    demurragePayment?: DemurragePaymentData,
    inspection?: InspectionStatus | null,
  ) => {
    const receiptWindow = window.open('', '_blank');
    if (!receiptWindow) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-in receive note.",
        variant: "destructive",
      });
      return;
    }

    const gateInDateRaw = new Date(containerData.gate_in_time);
    const dateStr = escapeHtml(gateInDateRaw.toLocaleDateString("en-GB").replace(/\//g, "/"));
    const timeStr = escapeHtml(gateInDateRaw.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    const ticketNum = String(parseInt(containerData.id.replace(/-/g, "").slice(0, 8), 16) % 1000000).padStart(6, "0");
    const yardName = escapeHtml(profile?.yard_name || "YARD");
    const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
    const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
    const printedAt = escapeHtml(new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""));
    const containerNumberSafe = escapeHtml(containerData.container_number);
    const shippingLineSafe = escapeHtml(containerData.shipping_line);
    const truckNumberSafe = escapeHtml(containerData.truck_number);
    const driverNameSafe = escapeHtml(containerData.driver_name);

    const ISO_DESCRIPTIONS: Record<string, string> = {
      "20FT": "20FT — 20ft Standard dry container",
      "40FT": "40FT — 40ft Standard dry container",
      "40HC": "40HC — 40ft High Cube dry container",
      "45FT": "45FT — 45ft High Cube dry container",
      "20FR": "20FR — 20ft Reefer container",
      "40FR": "40FR — 40ft Reefer container",
    };
    const isoLabel = escapeHtml(ISO_DESCRIPTIONS[containerData.container_type] || containerData.container_type);
    const grade = escapeHtml(inspection?.grade || "—");
    const notes = inspection?.grade ? `Condition: ${escapeHtml(inspection.grade)}.` : "";

    const financialSection = demurragePayment ? `
      <div class="section">
        <div class="section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          FINANCIAL SUMMARY
        </div>
        <div class="demurrage-card">
          <div>
            <div class="demurrage-label">DEMURRAGE COLLECTED</div>
            <div class="demurrage-ar">غرامات التأخير المحصلة</div>
            <div class="demurrage-amount">${demurragePayment.totalCollected.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span class="demurrage-currency">JOD</span></div>
          </div>
          <div class="demurrage-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9"/></svg>
          </div>
        </div>
        <div class="demurrage-breakdown">
          <div class="breakdown-row"><span>Demurrage (${demurragePayment.chargeableDays} day${demurragePayment.chargeableDays !== 1 ? "s" : ""})</span><span>${demurragePayment.demurrageAmount.toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
          <div class="breakdown-row"><span>Service Fee</span><span>${Number(demurragePayment.serviceFee).toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
          <div class="breakdown-row method"><span>Payment Method</span><span>${demurragePayment.paymentMethod === "cash" ? "💵 Cash" : "📲 Qlick"}</span></div>
        </div>
      </div>
    ` : `
      <div class="section">
        <div class="section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          FINANCIAL SUMMARY
        </div>
        <div class="no-demurrage">No demurrage collected — within free days or already paid.</div>
      </div>
    `;

    receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Reception Ticket — ${containerNumberSafe}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; color: #1e293b; }
    .page { max-width: 780px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }

    /* ── Header ── */
    .header { background: #1e3a5f; color: #fff; padding: 24px 32px 28px; position: relative; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .logo-text { color: #1e3a5f; font-weight: 800; font-size: 1.1rem; letter-spacing: 1px; }
    .header-center { text-align: center; flex: 1; padding: 0 24px; }
    .ticket-title { font-size: 1.7rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
    .ticket-title-ar { font-size: 0.9rem; color: #93c5fd; margin-top: 2px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .yard-name { font-size: 1.1rem; font-weight: 700; margin-top: 4px; letter-spacing: 1px; }
    .header-meta { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 10px; font-size: 0.85rem; color: #bfdbfe; }
    .ticket-num-box { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 4px 14px; font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; text-align: center; }
    .sl-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .sl-badge { background: #1e3a5f; color: #fff; border-radius: 6px; padding: 6px 14px; font-size: 1.1rem; font-weight: 800; letter-spacing: 2px; }
    .right-col { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

    /* ── Body ── */
    .body { padding: 0 32px 24px; }
    .section { border-bottom: 1px solid #e2e8f0; padding: 20px 0; }
    .section:last-of-type { border-bottom: none; }
    .section-header { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; }
    .field { }
    .field-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.05rem; color: #1e5fa0; letter-spacing: 1px; }
    .field-wide { grid-column: span 2; }

    /* ── Demurrage card ── */
    .demurrage-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .demurrage-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #16a34a; }
    .demurrage-ar { font-size: 0.75rem; color: #4ade80; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .demurrage-amount { font-size: 2rem; font-weight: 800; color: #16a34a; margin-top: 8px; }
    .demurrage-currency { font-size: 1rem; font-weight: 600; }
    .demurrage-breakdown { font-size: 0.8rem; color: #475569; }
    .breakdown-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .breakdown-row:last-child { border: none; }
    .breakdown-row.method { color: #0f172a; font-weight: 600; }
    .no-demurrage { font-size: 0.85rem; color: #64748b; font-style: italic; padding: 8px 0; }

    /* ── Notes ── */
    .notes-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; min-height: 52px; font-size: 0.9rem; color: #334155; }

    /* ── Signatures ── */
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 24px 32px 20px; border-top: 1px solid #e2e8f0; }
    .sig { text-align: center; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 6px; margin-bottom: 4px; }
    .sig-name { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1e3a5f; }
    .sig-name-ar { font-size: 0.72rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.85rem; font-weight: 600; color: #334155; margin-top: 3px; }

    /* ── Footer bar ── */
    .footer-bar { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 10px 32px; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #94a3b8; }
    .footer-brand { font-weight: 700; color: #475569; }

    @media print {
      body { background: #fff; }
      .page { box-shadow: none; margin: 0; border-radius: 0; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-inner">
      <div class="logo-box"><span class="logo-text">${yardName}</span></div>
      <div class="header-center">
        <div class="ticket-title">Reception Ticket</div>
        <div class="ticket-title-ar">وصل استلام حاوية</div>
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

  <!-- Body -->
  <div class="body">

    <!-- Container Information -->
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
          <div class="field-label">CONDITION / GRADE</div>
          <div class="field-value">${grade}</div>
        </div>
        <div class="field field-wide">
          <div class="field-label">RECEIVED AT</div>
          <div class="field-value">${yardName}</div>
        </div>
      </div>
    </div>

    <!-- Transport Information -->
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
      </div>
    </div>

    <!-- Financial Summary -->
    ${financialSection}

    <!-- Notes & Condition -->
    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        NOTES &amp; CONDITION
      </div>
      <div class="notes-box">${notes || "&nbsp;"}</div>
    </div>

  </div>

  <!-- Signatures -->
  <div class="signatures">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Shipping Line Rep.</div>
      <div class="sig-name-ar">ممثل الخط الملاحي</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

  <!-- Footer -->
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


  return (
    <div className="p-4 md:p-6 lg:p-8 animate-in fade-in-0 duration-300">
      <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader icon={Container} title="Gate In Container" subtitle="Record container arrivals and collect demurrage" />

      {pendingGateIns.length > 0 && (
        <Card className="border-green-400 bg-green-50/90">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-green-800 text-base">
              <ClipboardCheck className="h-5 w-5" />
              Awaiting Gate-In — {pendingGateIns.length} container{pendingGateIns.length !== 1 ? "s" : ""} approved
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingGateIns.map((item) => {
              const gradeColors: Record<string, string> = {
                A: "bg-green-500", B: "bg-blue-500", C: "bg-yellow-500", D: "bg-red-500",
              };
              return (
                <div
                  key={item.container_number}
                  className="flex items-center justify-between bg-white rounded-lg border border-green-200 px-4 py-3 cursor-pointer hover:bg-green-50 transition-colors"
                  onClick={() => setFormData((prev) => ({ ...prev, containerNumber: item.container_number }))}
                >
                  <div className="flex items-center gap-3">
                    <Badge className={`${gradeColors[item.grade] ?? "bg-gray-400"} text-white`}>
                      {item.grade}
                    </Badge>
                    <div>
                      <div className="font-mono font-semibold text-gray-900">{item.container_number}</div>
                      {item.notes && (
                        <div className="text-xs text-gray-500 truncate max-w-[18rem]">{item.notes}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-400 whitespace-nowrap ml-2">
                    {new Date(item.inspected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    <div className="text-green-600 font-medium mt-0.5">Tap to select →</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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

              {lookupDone && !alreadyInYard && (
                <div className={`mt-4 p-3 rounded-md border text-sm ${
                  inspectionStatus?.status === "approved"
                    ? "bg-green-50 border-green-300 text-green-700"
                    : inspectionStatus?.status === "rejected"
                      ? "bg-red-50 border-red-300 text-red-700"
                      : inspectionStatus?.status === "pending"
                        ? "bg-yellow-50 border-yellow-300 text-yellow-800"
                        : "bg-gray-50 border-gray-200 text-gray-500"
                }`}>
                  {!inspectionStatus && "ℹ️ No inspection record found for this container."}
                  {inspectionStatus?.status === "approved" && `✅ Inspection Approved — Grade ${inspectionStatus.grade}`}
                  {inspectionStatus?.status === "pending"  && "⏳ Inspection Pending — awaiting inspector decision."}
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
                    yardBlock: "",
                    yardRow: "",
                  });
                  setPortDataFound(false);
                  setLookupDone(false);
                  setDemurrageAlreadyPaid(false);
                  setAlreadyInYard(false);
                  setInspectionStatus(null);
                  setEarliestGateIn(null);
                }}
              >
                Clear Form
              </Button>
              <Button
                type="submit"
                className="bg-maritime hover:bg-maritime/90"
                disabled={isSubmitting || hasDemurrageDue || alreadyInYard || !portDataComplete || isInspectionRejected}
              >
                {isSubmitting
                  ? "Processing..."
                  : alreadyInYard
                    ? "Already In Yard — Cannot Gate In"
                    : isInspectionRejected
                      ? "Inspection Rejected — Cannot Gate In"
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
            setDemurrageAlreadyPaid(true);

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

// ── Wizard step indicator ───────────────────────────────────────────────────
const GATE_IN_STEPS = ["Container", "Demurrage", "Transport"];

const GateInStepper = ({
  step1Done,
  step2Done,
  step3Done,
}: {
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
}) => {
  const doneFlags = [step1Done, step2Done, step3Done];
  const currentStep = doneFlags.findIndex((d) => !d); // first incomplete
  const active = currentStep === -1 ? 3 : currentStep; // 0-indexed, -1 = all done

  return (
    <div className="flex items-center gap-0 mt-3">
      {GATE_IN_STEPS.map((label, i) => {
        const done = doneFlags[i];
        const isCurrent = i === active;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  done
                    ? "bg-success border-success text-white"
                    : isCurrent
                      ? "bg-maritime border-maritime text-white"
                      : "bg-muted border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                  done ? "text-success" : isCurrent ? "text-maritime" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < GATE_IN_STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${
                  done ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default GateIn;
