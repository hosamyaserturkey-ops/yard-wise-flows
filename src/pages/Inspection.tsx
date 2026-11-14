import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { uploadVehiclePhoto, vehiclePhotoUrl } from "@/lib/vehiclePhotos";
import {
  DAMAGE_ANGLE, FUEL_LEVELS, PHASE_LABEL, REQUIRED_SHOTS, SHOTS, closeBlocker, damagePhotos, isPhase,
  latestByAngle, missingShots, parseKm,
} from "@/lib/inspection";

interface Visit {
  id: string;
  status: string;
  vehicles: { vin: string; model: string | null; model_year: number | null; color: string | null } | null;
  manufacturers: { name: string } | null;
}
interface Inspection {
  id: string;
  status: "open" | "closed";
  odometer: number | null;
  fuel_level: string | null;
  keys_present: boolean | null;
  notes: string | null;
  closed_at: string | null;
}
interface Photo { id: string; angle: string; note: string | null; created_at: string; }

/** A photo, fetched with the user's login and shown from memory. */
function Thumb({ photoId, alt, className }: { photoId: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    vehiclePhotoUrl(photoId).then((u) => live && setSrc(u), () => live && setFailed(true));
    return () => { live = false; };
  }, [photoId]);
  if (failed) return <div className={cn("flex items-center justify-center text-xs text-destructive", className)}>Could not load</div>;
  if (!src) return <div className={cn("flex items-center justify-center", className)}><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return <img src={src} alt={alt} className={cn("object-cover", className)} />;
}

/** Phones and tablets open the camera; a PC opens a file picker. */
const usesCamera = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/**
 * The car-lot inspection form: the walk-round photos, the details, and closing.
 * Built for a phone or tablet in the lot first (large tap targets, camera
 * opens straight from a tile) and works the same on a PC.
 */
const InspectionPage = () => {
  const { visitId = "", phase: phaseParam } = useParams();
  const { toast } = useToast();
  const { isReadOnlyAdmin } = useAuth();
  const phase = isPhase(phaseParam) ? phaseParam : null;

  const [visit, setVisit] = useState<Visit | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [details, setDetails] = useState({ odometer: "", fuel: "", keys: false, notes: "" });
  const [damageNote, setDamageNote] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const pendingAngle = useRef<{ angle: string; note?: string } | null>(null);

  const load = useCallback(async () => {
    if (!phase) { setLoading(false); return; }
    const [visitRes, inspRes] = await Promise.all([
      supabase.from("vehicle_visits")
        .select("id, status, vehicles(vin, model, model_year, color), manufacturers(name)").eq("id", visitId).maybeSingle(),
      supabase.from("vehicle_inspections")
        .select("id, status, odometer, fuel_level, keys_present, notes, closed_at").eq("visit_id", visitId).eq("phase", phase).maybeSingle(),
    ]);
    const error = visitRes.error ?? inspRes.error;
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    setVisit((visitRes.data ?? null) as unknown as Visit | null);
    const insp = (inspRes.data ?? null) as Inspection | null;
    setInspection(insp);
    if (insp) {
      setDetails({ odometer: insp.odometer?.toString() ?? "", fuel: insp.fuel_level ?? "", keys: insp.keys_present ?? false, notes: insp.notes ?? "" });
      const { data, error: pErr } = await supabase.from("vehicle_inspection_photos")
        .select("id, angle, note, created_at").eq("inspection_id", insp.id).order("created_at");
      if (pErr) toast({ title: "Error", description: pErr.message, variant: "destructive" });
      setPhotos(data ?? []);
    } else {
      setPhotos([]);
    }
    setLoading(false);
  }, [visitId, phase, toast]);
  useEffect(() => { load(); }, [load]);

  const closed = inspection?.status === "closed";
  const editable = !!inspection && !closed && !isReadOnlyAdmin();
  const latest = latestByAngle(photos);
  const damage = damagePhotos(photos);
  const blocker = closeBlocker(photos, uploading.size > 0);
  const doneCount = REQUIRED_SHOTS.length - missingShots(photos).length;

  const start = async () => {
    if (!phase) return;
    setSaving(true);
    const { error } = await supabase.from("vehicle_inspections").insert({ visit_id: visitId, phase });
    setSaving(false);
    if (error) {
      toast({
        title: "Not started",
        description: /closed|released/i.test(error.message) ? "This car has already been released." : error.message,
        variant: "destructive",
      });
      return;
    }
    load();
  };

  const takePhoto = (angle: string, note?: string) => {
    pendingAngle.current = { angle, note };
    fileInput.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = pendingAngle.current;
    e.target.value = ""; // so the same file can be chosen again
    if (!file || !target || !inspection) return;
    const key = target.angle === DAMAGE_ANGLE ? `${DAMAGE_ANGLE}-${Date.now()}` : target.angle;
    setUploading((s) => new Set(s).add(key));
    try {
      await uploadVehiclePhoto(file, inspection.id, target.angle, target.note);
      if (target.angle === DAMAGE_ANGLE) setDamageNote("");
      await load();
    } catch (err) {
      toast({ title: "Photo not saved", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setUploading((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const saveDetails = async (): Promise<boolean> => {
    if (!inspection) return false;
    const odometer = parseKm(details.odometer);
    if (odometer === undefined) { toast({ title: "Check the odometer", description: "Whole kilometres only.", variant: "destructive" }); return false; }
    setSaving(true);
    const { error } = await supabase.from("vehicle_inspections").update({
      odometer, fuel_level: details.fuel || null, keys_present: details.keys, notes: details.notes.trim() || null,
    }).eq("id", inspection.id);
    setSaving(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return false; }
    return true;
  };

  const close = async () => {
    if (!inspection) return;
    if (!(await saveDetails())) return;
    setSaving(true);
    const { error } = await supabase.from("vehicle_inspections").update({ status: "closed" }).eq("id", inspection.id);
    setSaving(false);
    setCloseOpen(false);
    if (error) { toast({ title: "Not closed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Inspection closed" });
    load();
  };

  if (!phase) return <div className="p-6 text-muted-foreground">This inspection link is not valid.</div>;
  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!visit) return <div className="p-6 text-muted-foreground">Car not found, or you may not see it.</div>;

  const car = [visit.vehicles?.model, visit.vehicles?.model_year, visit.vehicles?.color].filter(Boolean).join(" · ");

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 animate-in fade-in-0 duration-300">
      {/* hidden: one picker serves every tile; capture opens the camera on touch devices */}
      <input ref={fileInput} type="file" accept="image/*" capture={usesCamera() ? "environment" : undefined} className="hidden" onChange={onFile} />

      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/cars"><ArrowLeft className="h-4 w-4 mr-1" /> Cars</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-maritime" /> {PHASE_LABEL[phase]}
            </h1>
            <p className="font-mono text-sm mt-1 break-all">{visit.vehicles?.vin}</p>
            <p className="text-sm text-muted-foreground">{[visit.manufacturers?.name, car].filter(Boolean).join(" · ")}</p>
          </div>
          {inspection && (
            <Badge variant={closed ? "secondary" : "outline"}>
              {closed ? `Closed ${inspection.closed_at ? `${formatDate(inspection.closed_at)} ${formatTime(inspection.closed_at)}` : ""}` : "Open"}
            </Badge>
          )}
        </div>
      </div>

      {!inspection ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            {isReadOnlyAdmin() ? (
              <p className="text-muted-foreground">No inspection was done for this step.</p>
            ) : visit.status === "out" ? (
              <p className="text-muted-foreground">No inspection was done, and the car has been released.</p>
            ) : (
              <>
                <p className="text-muted-foreground">No inspection yet for this step.</p>
                <Button size="lg" onClick={start} disabled={saving} className="min-h-12">
                  {saving ? "Starting…" : "Start inspection"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Photos</span>
                <span className="text-sm font-normal text-muted-foreground">{doneCount} of {REQUIRED_SHOTS.length} required</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
                {SHOTS.map((shot) => {
                  const photo = latest.get(shot.id);
                  const busy = uploading.has(shot.id);
                  return (
                    <button
                      key={shot.id}
                      type="button"
                      disabled={!editable || busy}
                      onClick={() => takePhoto(shot.id)}
                      aria-label={`${shot.label}${photo ? ", taken. Tap to retake" : shot.required ? ", required" : ", optional"}`}
                      className={cn(
                        "relative aspect-[4/3] overflow-hidden rounded-lg border text-left",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        photo ? "border-success/50" : shot.required ? "border-dashed border-muted-foreground/50" : "border-dashed border-muted-foreground/30",
                        editable && "active:scale-[0.98] transition-transform",
                      )}
                    >
                      {photo ? <Thumb photoId={photo.id} alt={shot.label} className="absolute inset-0 h-full w-full" />
                        : <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-muted-foreground">
                            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                            <span className="text-xs leading-tight">{shot.hint}</span>
                          </div>}
                      {busy && photo && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-background/85 px-2 py-1 text-xs font-medium">
                        <span>{shot.label}{!shot.required && <span className="text-muted-foreground"> (optional)</span>}</span>
                        {photo && <CheckCircle2 className="h-4 w-4 text-success" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Damage</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {damage.length === 0 && <p className="text-sm text-muted-foreground">No damage photos. Add one for every scratch, dent or crack you find.</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
                {damage.map((p) => (
                  <div key={p.id} className="overflow-hidden rounded-lg border">
                    <Thumb photoId={p.id} alt={p.note ?? "Damage"} className="aspect-[4/3] w-full" />
                    <p className="p-2 text-xs">{p.note || "—"}</p>
                  </div>
                ))}
              </div>
              {editable && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input value={damageNote} onChange={(e) => setDamageNote(e.target.value)} maxLength={500}
                    placeholder="What and where, e.g. dent, rear left door" className="h-12 sm:h-10" />
                  <Button variant="outline" className="min-h-12 sm:min-h-10" disabled={!damageNote.trim() || [...uploading].some((k) => k.startsWith(DAMAGE_ANGLE))}
                    onClick={() => takePhoto(DAMAGE_ANGLE, damageNote.trim())}>
                    <Plus className="h-4 w-4 mr-1" /> Add damage photo
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="odo">Odometer (km)</Label>
                <Input id="odo" inputMode="numeric" className="h-12 sm:h-10" disabled={!editable} value={details.odometer}
                  onChange={(e) => setDetails({ ...details, odometer: e.target.value })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="keys">Keys present</Label>
                <Switch id="keys" disabled={!editable} checked={details.keys} onCheckedChange={(v) => setDetails({ ...details, keys: v })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Fuel</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {FUEL_LEVELS.map((f) => (
                    <Button key={f.id} type="button" disabled={!editable} className="min-h-12 sm:min-h-10 px-1"
                      variant={details.fuel === f.id ? "default" : "outline"} onClick={() => setDetails({ ...details, fuel: f.id })}>
                      {f.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={3} disabled={!editable} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          {editable && (
            <Card>
              <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 py-4">
                <p className="flex-1 text-sm text-muted-foreground">{blocker ?? "All required photos are in. Closing cannot be undone."}</p>
                <Button variant="outline" className="min-h-12 sm:min-h-10" onClick={saveDetails} disabled={saving}>Save details</Button>
                <Button className="min-h-12 sm:min-h-10" onClick={() => setCloseOpen(true)} disabled={!!blocker || saving}>Close inspection</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Close this inspection?</DialogTitle>
            <DialogDescription>
              Once closed, the photos and details can never be changed. Check that every photo is clear and shows the right part of the car.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Go back</Button>
            <Button onClick={close} disabled={saving}>{saving ? "Closing…" : "Close inspection"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InspectionPage;
