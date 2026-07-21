import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Container,
  Ship,
  Truck,
  CalendarDays,
  ClipboardCheck,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Camera,
  Printer,
  History,
} from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { calculateDemurrage, hasDemurrageRules } from "@/lib/demurrage";
import { printGateInReceipt } from "@/lib/gateInReceipt";
import { printGateOutReceipt } from "@/lib/gateOutReceipt";
import { resolveSignedUrl } from "@/lib/storage";
import { Button } from "@/components/ui/button";

interface PortData {
  port_arrival_date: string | null;
  free_days: number | null;
  shipping_line: string;
}

interface InspectionData {
  grade: string;
  notes: string | null;
  created_at: string;
  status: string;
  photo_urls: string[] | null;
}

interface DemurragePayment {
  id: string;
  total_collected: number;
  chargeable_days: number;
  demurrage_amount: number;
  service_fee: number | null;
  payment_method: string | null;
  created_at: string;
}

// One row per yard visit — each visit snapshots its trip's port data at
// gate-in, so previous trips stay viewable after new port data is imported.
interface VisitHistory {
  id: string;
  gate_in_time: string;
  gate_out_time: string | null;
  port_arrival_date: string | null;
  free_days: number | null;
  driver_name: string | null;
  truck_number: string | null;
}


interface Props {
  container: ContainerType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-red-100 text-red-800 border-red-300",
};

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "outline" | "secondary" | "destructive" }> = {
  "in-yard": { label: "IN YARD", variant: "default" },
  reserved: { label: "RESERVED", variant: "outline" },
  out: { label: "OUT", variant: "secondary" },
};

const ContainerDetailDialog = ({ container, open, onOpenChange }: Props) => {
  const { currentYardId, profile } = useAuth();
  const { toast } = useToast();
  const [portData, setPortData] = useState<PortData | null>(null);
  const [inspection, setInspection] = useState<InspectionData | null>(null);
  const [payments, setPayments] = useState<DemurragePayment[]>([]);
  const [visits, setVisits] = useState<VisitHistory[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !container) {
      setPortData(null);
      setInspection(null);
      setPayments([]);
      setVisits([]);
      setPhotoUrls([]);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      try {
        const num = container.containerNumber;

        const yardId = currentYardId();
        let portQuery = supabase
          .from("container_port_data")
          .select("port_arrival_date, free_days, shipping_line, yard_id")
          .eq("container_number", num);
        if (yardId) portQuery = portQuery.eq("yard_id", yardId);

        const [portRes, inspRes, payRes] = await Promise.all([
          portQuery
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),

          supabase
            .from("inspector_checks")
            .select("grade, notes, created_at, status, photo_urls")
            .eq("container_number", num)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),

          supabase
            .from("demurrage_payments")
            .select("id, total_collected, chargeable_days, demurrage_amount, service_fee, payment_method, created_at")
            .eq("container_number", num)
            .order("created_at", { ascending: false }),

        ]);

        setPortData(portRes.data ?? null);
        const insp = inspRes.data ? { ...inspRes.data, photo_urls: Array.isArray(inspRes.data.photo_urls) ? inspRes.data.photo_urls as string[] : null } : null;
        setInspection(insp);
        setPayments(payRes.data ?? []);

        // Full visit history — every trip keeps its own snapshot of port
        // arrival date and free days, taken at gate-in.
        let masterId = container.containerId;
        if (!masterId) {
          const { data: master } = await supabase
            .from("containers")
            .select("id")
            .eq("container_number", num)
            .maybeSingle();
          masterId = master?.id;
        }
        if (masterId) {
          const { data: visitRows } = await supabase
            .from("container_visits")
            .select("id, gate_in_time, gate_out_time, port_arrival_date, free_days, driver_name, truck_number")
            .eq("container_id", masterId)
            .order("gate_in_time", { ascending: false });
          setVisits(visitRows ?? []);
        } else {
          setVisits([]);
        }
        if (insp?.photo_urls?.length) {
          const signed = await Promise.all(
            insp.photo_urls.map((p) => resolveSignedUrl("inspection-photos", p)),
          );
          setPhotoUrls(signed.filter((u): u is string => !!u));
        } else {
          setPhotoUrls([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [open, container]);

  if (!container) return null;

  // Latest payment — used for the paid badge and receipt reprint.
  const payment = payments[0] ?? null;

  // Demurrage: cap at gate-in for all statuses (demurrage stops when container enters yard)
  const capDate = container.gateInTime;
  const demurrage = portData?.port_arrival_date
    ? calculateDemurrage(
        container.shippingLine,
        container.containerType,
        portData.port_arrival_date,
        capDate,
      )
    : null;

  const statusInfo = STATUS_LABEL[container.status] ?? { label: container.status.toUpperCase(), variant: "secondary" as const };

  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Reprint the gate-in reception ticket from stored data. Payment details are
  // included when a demurrage payment is on file for this container.
  const handleReprint = () => {
    const printed = printGateInReceipt(
      {
        id: container.id,
        ticket_number: container.ticketNumber,
        container_number: container.containerNumber,
        container_type: container.containerType,
        shipping_line: container.shippingLine,
        driver_name: container.driverName,
        truck_number: container.truckNumber,
        gate_in_time: container.gateInTime.toISOString(),
      },
      payment
        ? {
            id: payment.id,
            chargeableDays: payment.chargeable_days,
            demurrageAmount: Number(payment.demurrage_amount),
            serviceFee: Number(payment.service_fee ?? 0),
            totalCollected: Number(payment.total_collected),
            paymentMethod: payment.payment_method ?? "cash",
          }
        : undefined,
      inspection ? { status: inspection.status as "approved" | "rejected" | "pending", grade: inspection.grade } : null,
      profile,
    );
    if (!printed) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-in receive note.",
        variant: "destructive",
      });
    }
  };

  // Reprint the gate-out ticket from stored data (only offered once the
  // container has actually gated out).
  const handleGateOutReprint = () => {
    if (!container.gateOutTime) return;
    const printed = printGateOutReceipt(
      {
        ticket_number: container.ticketNumber,
        container_number: container.containerNumber,
        container_type: container.containerType,
        shipping_line: container.shippingLine,
        booking_number: container.bookingNumber || null,
        truck_number: container.truckNumber || null,
        driver_name: container.driverName || null,
        gate_in_time: container.gateInTime,
        gate_out_time: container.gateOutTime,
        fees: Number(container.fees ?? 0),
      },
      profile,
    );
    if (!printed) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-out ticket.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Container className="h-5 w-5 text-maritime" />
            <span className="font-mono text-lg">{container.containerNumber}</span>
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              {container.containerType}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center items-center py-12 text-muted-foreground">
            Loading details…
          </div>
        ) : (
          <div className="space-y-5">
            {/* ── Container & Shipping ─────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <InfoBlock icon={<Ship className="h-4 w-4 text-maritime" />} label="Shipping Line">
                <span className="font-semibold">{container.shippingLine}</span>
              </InfoBlock>

              <InfoBlock icon={<CalendarDays className="h-4 w-4 text-maritime" />} label="Gate In">
                <span>{fmt(container.gateInTime)}</span>
                <span className="text-muted-foreground text-xs ml-1">{fmtTime(container.gateInTime)}</span>
              </InfoBlock>

              {container.gateOutTime && (
                <InfoBlock icon={<CalendarDays className="h-4 w-4 text-success" />} label="Gate Out">
                  <span>{fmt(container.gateOutTime)}</span>
                  <span className="text-muted-foreground text-xs ml-1">{fmtTime(container.gateOutTime)}</span>
                </InfoBlock>
              )}

              {container.bookingNumber && (
                <InfoBlock icon={<ClipboardCheck className="h-4 w-4 text-maritime" />} label="Booking #">
                  <span className="font-mono">{container.bookingNumber}</span>
                </InfoBlock>
              )}
            </div>

            {/* ── Transport ─────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <InfoBlock icon={<Truck className="h-4 w-4 text-warning" />} label="Driver">
                {container.driverName}
              </InfoBlock>
              <InfoBlock icon={<Truck className="h-4 w-4 text-warning" />} label="Truck">
                <span className="font-mono">{container.truckNumber}</span>
              </InfoBlock>
              {(container as unknown as { yardBlock?: string; yardRow?: string }).yardBlock && (
                <InfoBlock icon={<MapPin className="h-4 w-4 text-maritime" />} label="Yard Slot">
                  <span className="font-mono">
                    {(container as unknown as { yardBlock?: string }).yardBlock}
                    {" · Row "}
                    {(container as unknown as { yardRow?: string }).yardRow ?? "—"}
                  </span>
                </InfoBlock>
              )}
              <InfoBlock icon={<Camera className="h-4 w-4 text-maritime" />} label="Photos">
                <Link
                  to={`/photos?q=${encodeURIComponent(container.containerNumber)}`}
                  className="text-maritime underline underline-offset-2 text-sm"
                  onClick={() => onOpenChange(false)}
                >
                  View gate-in photos →
                </Link>
              </InfoBlock>
            </div>

            <Separator />

            {/* ── Port Data & Demurrage ─────────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Demurrage at Gate-In
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Demurrage is settled once when the container is first gated in. It does not accrue while the container sits in the yard.
              </p>

              {!portData ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  No port data on file for this container.
                </div>
              ) : !hasDemurrageRules(container.shippingLine) ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  No demurrage rules configured for <strong>{container.shippingLine}</strong>.
                </div>
              ) : demurrage ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-muted/40 rounded-lg p-3">
                      <div className="text-muted-foreground text-xs mb-1">Port Arrival</div>
                      <div className="font-medium">{portData.port_arrival_date ? fmt(new Date(portData.port_arrival_date)) : "—"}</div>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3">
                      <div className="text-muted-foreground text-xs mb-1">Days at Port</div>
                      <div className="font-medium">{demurrage.daysElapsed} days</div>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3">
                      <div className="text-muted-foreground text-xs mb-1">Free Days</div>
                      <div className="font-medium">{demurrage.freeDays} days</div>
                    </div>
                  </div>

                  {demurrage.breakdown.length > 0 ? (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Days</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rate (USD)</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demurrage.breakdown.map((row, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2">{row.period}</td>
                              <td className="text-right px-3 py-2">{row.days}</td>
                              <td className="text-right px-3 py-2">${row.rateUSD}/day</td>
                              <td className="text-right px-3 py-2 font-medium">${row.subtotalUSD.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t bg-muted/30">
                          <tr>
                            <td colSpan={3} className="px-3 py-2 font-semibold">Total</td>
                            <td className="text-right px-3 py-2 font-bold text-maritime">
                              ${demurrage.totalUSD.toFixed(2)} / {demurrage.totalJOD.toFixed(2)} JOD
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-success bg-success/10 rounded-lg p-3 border border-success/20">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Within free days — no demurrage due.
                    </div>
                  )}

                  {/* Payment status — only show 'paid' badge; demurrage doesn't accrue after gate-in */}
                  {payment && (
                    <div className="flex items-center gap-2 text-sm text-success bg-success/10 rounded-lg p-3 border border-success/20">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Demurrage paid: <strong>{Number(payment.total_collected).toFixed(2)} JOD</strong>
                      <span className="text-muted-foreground text-xs ml-auto">
                        {fmt(new Date(payment.created_at))}
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <Separator />

            {/* ── Inspection ────────────────────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" /> Inspection
              </h3>
              {!inspection ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                  <Clock className="h-4 w-4 shrink-0" />
                  No inspection on record.
                </div>
              ) : (
                <div className="flex items-start gap-4 bg-muted/40 rounded-lg p-3">
                  <Badge
                    className={`text-lg font-bold px-3 py-1 border ${GRADE_COLOR[inspection.grade] ?? ""}`}
                  >
                    {inspection.grade}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={inspection.status === "approved" ? "default" : inspection.status === "rejected" ? "destructive" : "outline"}
                        className="text-xs"
                      >
                        {inspection.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {fmt(new Date(inspection.created_at))} {fmtTime(new Date(inspection.created_at))}
                      </span>
                    </div>
                    {inspection.notes && (
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{inspection.notes}</p>
                    )}
                    {photoUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {photoUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt={`Inspection photo ${i + 1}`}
                              className="h-16 w-16 object-cover rounded border border-border hover:opacity-80 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Visit & payment history ───────────────────────── */}
            {(visits.length > 1 || payments.length > 1) && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
                    <History className="h-4 w-4" /> Previous Visits & Payments
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Each visit keeps its own port arrival date and demurrage settlement. New trips don't erase old records.
                  </p>

                  {visits.length > 1 && (
                    <div className="rounded-lg border overflow-hidden mb-3">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Gate In</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Gate Out</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Port Arrival</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Driver</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visits.map((v) => (
                            <tr key={v.id} className={`border-t ${v.id === container.id ? "bg-maritime/5" : ""}`}>
                              <td className="px-3 py-2">
                                {fmt(new Date(v.gate_in_time))}
                                {v.id === container.id && (
                                  <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">current</Badge>
                                )}
                              </td>
                              <td className="px-3 py-2">{v.gate_out_time ? fmt(new Date(v.gate_out_time)) : "—"}</td>
                              <td className="px-3 py-2">{v.port_arrival_date ? fmt(new Date(v.port_arrival_date)) : "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{v.driver_name ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {payments.length > 1 && (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Paid On</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Days</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Method</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Collected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p) => (
                            <tr key={p.id} className="border-t">
                              <td className="px-3 py-2">{fmt(new Date(p.created_at))}</td>
                              <td className="text-right px-3 py-2">{p.chargeable_days}</td>
                              <td className="text-right px-3 py-2 capitalize">{p.payment_method ?? "—"}</td>
                              <td className="text-right px-3 py-2 font-medium">{Number(p.total_collected).toFixed(2)} JOD</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            <Separator />

            {/* ── Reprint ───────────────────────────────────────── */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleReprint}>
                <Printer className="h-4 w-4 mr-2" />
                Reprint Gate-In Receipt
              </Button>
              {container.gateOutTime && (
                <Button variant="outline" onClick={handleGateOutReprint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Reprint Gate-Out Ticket
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── tiny helper ──────────────────────────────────────────────────────────────
const InfoBlock = ({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-2">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium flex items-baseline gap-1">{children}</div>
    </div>
  </div>
);

export default ContainerDetailDialog;
