import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { calculateDemurrage, hasDemurrageRules } from "@/lib/demurrage";

interface PortData {
  port_arrival_date: string | null;
  free_days: number | null;
  shipping_line: string;
}

interface InspectionData {
  grade: string;
  notes: string | null;
  inspected_at: string;
  status: string;
  photo_urls?: string[] | null;
}

interface DemurragePayment {
  amount_jod: number;
  paid_at: string;
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
  const [portData, setPortData] = useState<PortData | null>(null);
  const [inspection, setInspection] = useState<InspectionData | null>(null);
  const [payment, setPayment] = useState<DemurragePayment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !container) {
      setPortData(null);
      setInspection(null);
      setPayment(null);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      try {
        const num = container.containerNumber;

        const [portRes, inspRes, payRes] = await Promise.all([
          supabase
            .from("container_port_data")
            .select("port_arrival_date, free_days, shipping_line")
            .eq("container_number", num)
            .maybeSingle(),

          supabase
            .from("inspector_checks")
            .select("grade, notes, inspected_at, status, photo_urls")
            .eq("container_number", num)
            .order("inspected_at", { ascending: false })
            .limit(1)
            .maybeSingle(),

          supabase
            .from("demurrage_payments")
            .select("amount_jod, paid_at")
            .eq("container_number", num)
            .order("paid_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        setPortData(portRes.data ?? null);
        setInspection(inspRes.data ?? null);
        setPayment(payRes.data ?? null);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [open, container]);

  if (!container) return null;

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
                      Demurrage paid: <strong>{payment.amount_jod.toFixed(2)} JOD</strong>
                      <span className="text-muted-foreground text-xs ml-auto">
                        {fmt(new Date(payment.paid_at))}
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
                        {fmt(new Date(inspection.inspected_at))} {fmtTime(new Date(inspection.inspected_at))}
                      </span>
                    </div>
                    {inspection.notes && (
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{inspection.notes}</p>
                    )}
                    {inspection.photo_urls && inspection.photo_urls.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground font-medium mb-2">
                          INSPECTION PHOTOS ({inspection.photo_urls.length})
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {inspection.photo_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                              <img
                                src={url}
                                alt={`Inspection photo ${i + 1}`}
                                className="w-full aspect-square object-cover rounded-lg border hover:opacity-90 transition-opacity"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
