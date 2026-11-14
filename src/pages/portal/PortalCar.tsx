import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { VehiclePhoto } from "@/components/VehiclePhoto";
import { useI18n } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/messages";
import { daysInLot, type VisitStatus } from "@/lib/carLot";
import { DAMAGE_ANGLE, SHOTS, damagePhotos, latestByAngle } from "@/lib/inspection";
import { formatPortalDate, formatPortalDateTime } from "@/lib/portalDates";
import { ArrowLeft } from "lucide-react";

interface Vehicle { id: string; vin: string; model: string | null; model_year: number | null; color: string | null; }
interface Visit {
  id: string; status: VisitStatus; ticket_number: number; gate_in_time: string; gate_out_time: string | null;
  lot_zone: string | null; lot_slot: string | null; free_days: number;
}
interface Inspection {
  id: string; visit_id: string; phase: "gate_in" | "gate_out"; status: "open" | "closed";
  odometer: number | null; fuel_level: string | null; keys_present: boolean | null; notes: string | null; closed_at: string | null;
}
interface Photo { id: string; inspection_id: string; angle: string; note: string | null; created_at: string; }

const FUEL_KEYS: Record<string, MessageKey> = {
  empty: "fuel.empty", quarter: "fuel.quarter", half: "fuel.half", three_quarter: "fuel.three_quarter", full: "fuel.full",
};

/** One car: its visits to the lot, and the arrival and departure inspections with photos. Read-only. */
const PortalCar = () => {
  const { vehicleId = "" } = useParams();
  const { t, lang } = useI18n();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setFailed(false);
      const [v, vs] = await Promise.all([
        supabase.from("vehicles").select("id, vin, model, model_year, color").eq("id", vehicleId).maybeSingle(),
        supabase.from("vehicle_visits")
          .select("id, status, ticket_number, gate_in_time, gate_out_time, lot_zone, lot_slot, free_days")
          .eq("vehicle_id", vehicleId).order("gate_in_time", { ascending: false }),
      ]);
      if (!live) return;
      if (v.error || vs.error) setFailed(true);
      const visitRows = (vs.data ?? []) as Visit[];
      const insp = visitRows.length
        ? await supabase.from("vehicle_inspections")
            .select("id, visit_id, phase, status, odometer, fuel_level, keys_present, notes, closed_at")
            .in("visit_id", visitRows.map((x) => x.id))
        : { data: [], error: null };
      if (!live) return;
      const inspRows = (insp.data ?? []) as Inspection[];
      // Photos of an inspection still in progress are not shown: it may be half done.
      const closedIds = inspRows.filter((i) => i.status === "closed").map((i) => i.id);
      const pics = closedIds.length
        ? await supabase.from("vehicle_inspection_photos").select("id, inspection_id, angle, note, created_at").in("inspection_id", closedIds).order("created_at")
        : { data: [], error: null };
      if (!live) return;
      if (insp.error || pics.error) setFailed(true);
      setVehicle((v.data ?? null) as Vehicle | null);
      setVisits(visitRows);
      setInspections(inspRows);
      setPhotos((pics.data ?? []) as Photo[]);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [vehicleId]);

  const angleLabel = (angle: string) => t(`angle.${angle}` as MessageKey);
  const now = new Date();

  const renderInspection = (visit: Visit, phase: "gate_in" | "gate_out") => {
    const insp = inspections.find((i) => i.visit_id === visit.id && i.phase === phase);
    const heading = t(phase === "gate_in" ? "car.inspection.gate_in" : "car.inspection.gate_out");
    if (!insp) return (
      <section key={phase} className="rounded-lg border p-3">
        <h4 className="font-medium">{heading}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{t("car.inspection.none")}</p>
      </section>
    );
    if (insp.status === "open") return (
      <section key={phase} className="rounded-lg border p-3">
        <h4 className="font-medium">{heading}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{t("car.inspection.open")}</p>
      </section>
    );
    const mine = photos.filter((p) => p.inspection_id === insp.id);
    const latest = latestByAngle(mine);
    const damage = damagePhotos(mine);
    const standard = SHOTS.filter((s) => latest.has(s.id));
    return (
      <section key={phase} className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">{heading}</h4>
          {insp.closed_at && <span className="text-xs text-muted-foreground">{t("car.inspection.closedAt", { when: formatPortalDateTime(insp.closed_at, lang) })}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">{t("car.odometer")}</dt><dd>{insp.odometer === null ? t("common.none") : t("car.km", { n: insp.odometer })}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("car.fuel")}</dt><dd>{insp.fuel_level && FUEL_KEYS[insp.fuel_level] ? t(FUEL_KEYS[insp.fuel_level]) : t("common.none")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("car.keys")}</dt><dd>{insp.keys_present === null ? t("common.none") : t(insp.keys_present ? "common.yes" : "common.no")}</dd></div>
          {insp.notes && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted-foreground">{t("car.notes")}</dt><dd className="whitespace-pre-wrap">{insp.notes}</dd></div>}
        </dl>
        <div>
          <h5 className="mb-2 text-sm font-medium">{t("car.photos")}</h5>
          {standard.length === 0 ? <p className="text-sm text-muted-foreground">{t("car.noPhotos")}</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {standard.map((s) => {
                const photo = latest.get(s.id)!;
                const label = angleLabel(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setZoom({ id: photo.id, label })} aria-label={`${t("car.photo.open")}: ${label}`}
                    className="relative aspect-[4/3] overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <VehiclePhoto photoId={photo.id} alt={label} failedText={t("car.photo.failed")} className="absolute inset-0 h-full w-full" />
                    <span className="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-start text-xs font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {damage.length > 0 && (
          <div>
            <h5 className="mb-2 text-sm font-medium">{t("car.damage")}</h5>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {damage.map((p) => (
                <button key={p.id} type="button" onClick={() => setZoom({ id: p.id, label: p.note || angleLabel(DAMAGE_ANGLE) })}
                  aria-label={`${t("car.photo.open")}: ${p.note ?? angleLabel(DAMAGE_ANGLE)}`}
                  className="overflow-hidden rounded-lg border text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <VehiclePhoto photoId={p.id} alt={p.note ?? angleLabel(DAMAGE_ANGLE)} failedText={t("car.photo.failed")} className="aspect-[4/3] w-full" />
                  <span className="block p-2 text-xs">{p.note || t("common.none")}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  if (loading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (!vehicle) return (
    <div className="space-y-3">
      <BackLink />
      <p className="text-muted-foreground">{failed ? t("common.error") : t("car.notFound")}</p>
    </div>
  );

  const model = [vehicle.model, vehicle.model_year, vehicle.color].filter(Boolean).join(" · ");
  return (
    <div className="space-y-4">
      <BackLink />
      {failed && <p role="alert" className="text-sm text-destructive">{t("common.error")}</p>}
      <div>
        <h2 className="text-xl font-bold sm:text-2xl">{t("car.title")}</h2>
        <p dir="ltr" className="mt-1 break-all font-mono text-sm text-start">{vehicle.vin}</p>
        <p className="text-sm text-muted-foreground">{model || t("common.none")}</p>
      </div>

      <h3 className="text-lg font-semibold">{t("car.visits")}</h3>
      {visits.map((visit, index) => (
        <Card key={visit.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{t("car.visit", { n: visits.length - index })} · {t("car.ticket", { n: visit.ticket_number })}</span>
              <Badge variant={visit.status === "on-hold" ? "outline" : "secondary"}>{t(`status.${visit.status}`)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t("car.arrived")}</dt><dd>{formatPortalDate(visit.gate_in_time, lang)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("car.released")}</dt><dd>{visit.gate_out_time ? formatPortalDate(visit.gate_out_time, lang) : t("common.none")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("car.daysStored")}</dt><dd>{daysInLot(visit.gate_in_time, now, visit.gate_out_time)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("car.spot")}</dt><dd dir="ltr" className="text-start">{[visit.lot_zone, visit.lot_slot].filter(Boolean).join(" / ") || t("common.none")}</dd></div>
            </dl>
            <h4 className="pt-1 text-sm font-semibold">{t("car.inspections")}</h4>
            {renderInspection(visit, "gate_in")}
            {renderInspection(visit, "gate_out")}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!zoom} onOpenChange={(open) => { if (!open) setZoom(null); }}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          <DialogHeader>
            <DialogTitle>{zoom?.label}</DialogTitle>
            <DialogDescription className="sr-only">{t("car.photos")}</DialogDescription>
          </DialogHeader>
          {zoom && <VehiclePhoto photoId={zoom.id} alt={zoom.label} failedText={t("car.photo.failed")} className="max-h-[75vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function BackLink() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="sm" className="-ms-2 min-h-10">
      <Link to="/portal"><ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" /> {t("common.back")}</Link>
    </Button>
  );
}

export default PortalCar;
