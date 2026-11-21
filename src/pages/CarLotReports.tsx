import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DateInput } from "@/components/DateInput";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYardKind } from "@/hooks/useYardKind";
import { useToast } from "@/hooks/use-toast";
import { loadLotReportData, type LotReportData } from "@/lib/carLotData";
import {
  buildLotReport, lotPeriodSummary, type CarLotReportContext, type LotReportKind,
} from "@/lib/reports/carLotReportData";
import { fetchYards } from "@/lib/reports/fetchReportData";
import { periodLabel } from "@/lib/reports/reportData";
import { periodFromFilters } from "@/lib/reports/reportFilters";
import { formatTime, toIsoDay } from "@/lib/format";

const REPORTS: { kind: LotReportKind; title: string; description: string }[] = [
  {
    kind: "stock",
    title: "Cars in the lot",
    description: "Every car in the lot right now: days in the lot, free days, spot, holds and damage noted at arrival. The period does not apply.",
  },
  {
    kind: "movements",
    title: "Movements",
    description: "Every arrival and release in the period with driver, truck and who handled it, plus a month-by-month summary per manufacturer.",
  },
  {
    kind: "dwell",
    title: "Dwell time",
    description: "The cars released in the period: days in the lot, free days and days over free, per car and per manufacturer.",
  },
  {
    kind: "damage",
    title: "Damage",
    description: "For cars that arrived or left in the period: the damage noted at arrival and at departure, side by side.",
  },
  {
    kind: "holds",
    title: "Holds",
    description: "Every hold in the period: when, by whom, why, when it was released and how long it lasted.",
  },
];

type Preset = "this-month" | "last-month" | "last-30";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-30", label: "Last 30 days" },
];

/** `yyyy-mm-dd` bounds of a preset period, as the date boxes hold them. */
function presetRange(preset: Preset, now: Date): { from: string; to: string } {
  if (preset === "this-month") return { from: toIsoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDay(now) };
  if (preset === "last-month") {
    return {
      from: toIsoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toIsoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { from: toIsoDay(start), to: toIsoDay(now) };
}

const ALL = "all";

/** The car lot's Excel reports. Read-only; every file is built from what the user may see. */
const CarLotReports = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { yardId, isCarLot } = useYardKind();
  const [range, setRange] = useState(() => presetRange("this-month", new Date()));
  const [maker, setMaker] = useState(ALL);
  const [makers, setMakers] = useState<{ code: string; name: string }[]>([]);
  const [preview, setPreview] = useState<{ at: Date; data: LotReportData } | null>(null);
  const [exporting, setExporting] = useState<LotReportKind | null>(null);

  const period = useMemo(() => periodFromFilters({ dateFrom: range.from, dateTo: range.to }), [range]);
  const backwards = !!(period.from && period.to && period.from > period.to);

  // Every manufacturer the lot has had, active or not: a past period may include a deactivated one.
  useEffect(() => {
    if (!yardId) return;
    void supabase.from("manufacturers").select("code, name").eq("yard_id", yardId).order("name")
      .then(({ data }) => setMakers(data ?? []));
  }, [yardId]);

  // The preview follows the period (after a short pause, so typing a date doesn't load each keystroke).
  useEffect(() => {
    if (!yardId || backwards) return;
    let cancelled = false;
    setPreview(null);
    const timer = window.setTimeout(async () => {
      const at = new Date();
      try {
        const data = await loadLotReportData(yardId, period, at);
        if (!cancelled) setPreview({ at, data });
      } catch (e) {
        if (!cancelled) toast({ title: "Preview not loaded", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [yardId, period, backwards, toast]);

  const keep = (v: { manufacturerCode: string }) => maker === ALL || v.manufacturerCode === maker;
  const makerName = makers.find((m) => m.code === maker)?.name ?? maker;

  const summary = useMemo(() => {
    if (!preview) return null;
    const visits = preview.data.visits.filter((v) => maker === ALL || v.manufacturerCode === maker);
    return lotPeriodSummary(visits, period, preview.at);
  }, [preview, period, maker]);

  const download = async (kind: LotReportKind) => {
    if (!yardId) return;
    setExporting(kind);
    try {
      // Always fresh data, never the preview's: a report says what is true when it is made.
      const now = new Date();
      const [data, yards] = await Promise.all([loadLotReportData(yardId, period, now), fetchYards()]);
      const visits = data.visits.filter(keep);
      const ids = new Set(visits.map((v) => v.id));
      const ctx: CarLotReportContext = {
        now,
        period,
        yardId,
        yardNames: Object.fromEntries(yards.map((y) => [y.id, y.name])),
        yardCodes: Object.fromEntries(yards.map((y) => [y.id, y.code])),
        filtersLabel: maker === ALL ? "" : `Manufacturer ${makerName}`,
        generatedBy: profile?.full_name?.trim() || profile?.username?.trim() || undefined,
      };
      const spec = buildLotReport(kind, visits, data.holds.filter((h) => ids.has(h.visitId)), ctx);
      const { downloadReport } = await import("@/lib/reports/workbook");
      await downloadReport(spec);
      toast({ title: "Report downloaded", description: spec.fileName });
    } catch (e) {
      toast({ title: "Report not made", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (!isCarLot) {
    return <div className="p-8 text-muted-foreground">Select a car-lot yard (top right) to see its reports.</div>;
  }

  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p.id, new Date());
    return r.from === range.from && r.to === range.to;
  })?.id;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader icon={FileSpreadsheet} title="Reports" subtitle="Excel files for the car lot" />

      {/* One filter row above everything it applies to. */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant={activePreset === p.id ? "default" : "outline"} className="min-h-9"
                aria-pressed={activePreset === p.id} onClick={() => setRange(presetRange(p.id, new Date()))}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lot-report-from">From</Label>
              <DateInput id="lot-report-from" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lot-report-to">To</Label>
              <DateInput id="lot-report-to" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
            </div>
            <div className="space-y-1">
              <Label>Manufacturer</Label>
              <Select value={maker} onValueChange={setMaker}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All manufacturers</SelectItem>
                  {makers.map((m) => <SelectItem key={m.code} value={m.code}>{m.name} ({m.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {backwards ? (
            <p className="text-sm text-destructive">The start of the period is after its end.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {periodLabel(period)}{maker === ALL ? "" : ` · ${makerName}`}. An empty date box leaves that side of the period open.
            </p>
          )}
        </CardContent>
      </Card>

      <section aria-label="This period at a glance" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Arrivals", value: summary?.arrivals },
          { label: "Releases", value: summary?.releases },
          { label: "Average days (released cars)", value: summary ? summary.avgDaysReleased.toFixed(1) : undefined },
          { label: "In the lot at the end", value: summary?.inLotAtEnd },
        ].map((f) => (
          <Card key={f.label}>
            <CardContent className="p-4 space-y-1">
              <p className="text-sm text-muted-foreground">{f.label}</p>
              {summary && !backwards ? (
                <p className="text-2xl font-bold">{f.value}</p>
              ) : backwards ? (
                <p className="text-2xl font-bold text-muted-foreground">—</p>
              ) : (
                <Skeleton className="h-8 w-16" />
              )}
            </CardContent>
          </Card>
        ))}
      </section>
      {preview && !backwards && (
        <p className="-mt-3 text-xs text-muted-foreground">Counted at {formatTime(preview.at)}. Each download reads the data again.</p>
      )}

      <section aria-label="Downloads" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const disabled = exporting !== null || (backwards && r.kind !== "stock");
          return (
            <Card key={r.kind} className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{r.title}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button variant="outline" className="w-full min-h-11" disabled={disabled} onClick={() => void download(r.kind)}>
                  {exporting === r.kind
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing…</>
                    : <><Download className="h-4 w-4 mr-2" /> Download Excel</>}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
};

export default CarLotReports;
