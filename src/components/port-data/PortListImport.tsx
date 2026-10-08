import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle, FileSpreadsheet, Info, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DEMURRAGE_RULES, hasDemurrageRules, lastFreeDay } from "@/lib/demurrage";
import { getCellByAliases, HEADER_ALIASES, parsePortRows, rowsFromSheet, type SheetRow } from "@/lib/portDataImport";
import { buildPortListRows, type PortListEntry, type VisitLite } from "@/lib/portListStatus";
import { fetchPortRowsFor, fetchVisitsFor } from "@/hooks/usePortList";
import { logActivity } from "@/lib/activityLog";
import { fmtDay, todayLocalISO } from "./format";

interface LoadedFile {
  fileName: string;
  rows: SheetRow[];
  visits: Map<string, VisitLite[]>;
  existing: Map<string, PortListEntry>;
}

const BATCH = 200;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Excel import of a line's port list: pick the line, choose the file, check
 * the preview, then import. Nothing is written until the preview is confirmed.
 */
export const PortListImport = ({
  chargedLines,
  repLine,
  userId,
  resolveYardIds,
  scopedYardId,
  onImported,
}: {
  chargedLines: string[];
  /** A line rep can only import their own line. */
  repLine: string | null;
  userId: string | undefined;
  resolveYardIds: () => Promise<string[]>;
  /** The yard the preview checks against; null when a super admin views every yard. */
  scopedYardId: string | null;
  onImported: () => void;
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState<string>(repLine ?? "");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [result, setResult] = useState<{ containers: number; errors: string[] } | null>(null);

  const parsed = useMemo(
    () => (loaded ? parsePortRows(loaded.rows, { defaultLine: line || null, lockedLine: repLine }) : null),
    [loaded, line, repLine],
  );

  // Where each container in the file stands today, from the yard's records.
  const statusRows = useMemo(
    () => (loaded && parsed ? buildPortListRows(parsed.records, loaded.visits) : []),
    [loaded, parsed],
  );

  const checks = useMemo(() => {
    if (!loaded || !parsed) return null;
    const returned = statusRows.filter((r) => r.status !== "awaiting");
    const mismatched = returned.filter((r) => r.recordedArrival || r.recordedFreeDays != null);
    const overdue = statusRows.filter((r) => r.status === "awaiting" && r.daysOver > 0);
    const nonStandard = parsed.records.filter(
      (r) => hasDemurrageRules(r.shipping_line) && r.free_days !== DEMURRAGE_RULES[r.shipping_line].freeDays,
    );
    const defaultedFree = parsed.records.filter((r) => r.freeDaysDefaulted);
    const noSize = parsed.records.filter((r) => !r.container_type);
    const today = todayLocalISO();
    const future = parsed.records.filter((r) => r.port_arrival_date > today);
    const changed = parsed.records.filter((r) => {
      const e = loaded.existing.get(r.container_number);
      return e && (e.port_arrival_date !== r.port_arrival_date || e.free_days !== r.free_days || e.shipping_line !== r.shipping_line);
    });
    const onFile = parsed.records.filter((r) => loaded.existing.has(r.container_number));

    const byArrival = new Map<string, { line: string; count: number; returned: number; free: Set<number> }>();
    for (const r of statusRows) {
      const key = `${r.shipping_line}|${r.port_arrival_date}`;
      const g = byArrival.get(key) ?? { line: r.shipping_line, count: 0, returned: 0, free: new Set<number>() };
      g.count += 1;
      if (r.status !== "awaiting") g.returned += 1;
      g.free.add(r.free_days);
      byArrival.set(key, g);
    }
    const groups = Array.from(byArrival.entries())
      .map(([key, g]) => ({ ...g, arrival: key.split("|")[1] }))
      .sort((a, b) => a.arrival.localeCompare(b.arrival) || a.line.localeCompare(b.line));
    const sizes = new Map<string, number>();
    for (const r of parsed.records) sizes.set(r.container_type ?? "No size", (sizes.get(r.container_type ?? "No size") ?? 0) + 1);

    return { returned, mismatched, overdue, nonStandard, defaultedFree, noSize, future, changed, onFile, groups, sizes };
  }, [loaded, parsed, statusRows]);

  const reset = () => {
    setLoaded(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = rowsFromSheet(workbook.Sheets[workbook.SheetNames[0]]);
      if (rows.length === 0) {
        toast({
          title: "No container column found",
          description: "The first sheet needs a column named Container, Container Id or Container Number.",
          variant: "destructive",
        });
        reset();
        return;
      }
      const numbers = rows
        .map((r) => String(getCellByAliases(r.values, HEADER_ALIASES.containerNumber) ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean);
      const [visits, existing] = await Promise.all([
        fetchVisitsFor(numbers, scopedYardId),
        fetchPortRowsFor(numbers, scopedYardId),
      ]);
      setLoaded({ fileName: file.name, rows, visits, existing });
    } catch (err) {
      toast({ title: "Could not read the file", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      reset();
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!loaded || !parsed || parsed.records.length === 0) return;
    setImporting(true);
    const errors: string[] = [];
    try {
      const yardIds = await resolveYardIds();
      if (yardIds.length === 0) throw new Error("No yard available to write port data");
      const records = parsed.records.flatMap((rec) =>
        yardIds.map((yardId) => ({
          container_number: rec.container_number,
          shipping_line: rec.shipping_line,
          // A file without a size keeps the size already on file.
          container_type: rec.container_type ?? loaded.existing.get(rec.container_number)?.container_type ?? null,
          port_arrival_date: rec.port_arrival_date,
          free_days: rec.free_days,
          daily_demurrage: 0, // NOT NULL in the database but unused: demurrage comes from the line's tiers
          last_source: "excel",
          yard_id: yardId,
        })),
      );
      let written = 0;
      for (let start = 0; start < records.length; start += BATCH) {
        const chunk = records.slice(start, start + BATCH);
        const { error } = await supabase.from("container_port_data").upsert(chunk, { onConflict: "container_number,yard_id" });
        if (error) errors.push(`Rows ${start + 1}-${start + chunk.length}: ${error.message}`);
        else written += chunk.length;
      }
      const containers = Math.round(written / yardIds.length);
      if (written > 0 && userId) {
        const lines = Array.from(new Set(parsed.records.map((r) => r.shipping_line)));
        const arrivals: Record<string, number> = {};
        for (const r of parsed.records) arrivals[r.port_arrival_date] = (arrivals[r.port_arrival_date] ?? 0) + 1;
        await Promise.all(
          yardIds.map((yardId) =>
            logActivity({
              userId,
              yardId,
              action: "port_data_imported",
              metadata: {
                file_name: loaded.fileName,
                containers,
                lines,
                arrival_dates: arrivals,
                non_standard_free_days: checks?.nonStandard.length ?? 0,
                failed_batches: errors.length,
              },
            }),
          ),
        );
      }
      setResult({ containers, errors });
      if (written > 0) {
        toast({ title: "Port list imported", description: `${plural(containers, "container")} saved.` });
        onImported();
      }
      if (errors.length === 0) reset();
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const lineOptions = repLine ? [repLine] : chargedLines;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-2">
        <p>Upload the port list a line sends: which containers to accept, and each one&rsquo;s arrival date and free days. Columns read:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Container Id</strong>, <strong>Container #</strong> or <strong>Container Number</strong></li>
          <li><strong>Size</strong> (20 / 40 / 45) and/or <strong>Container Type</strong> (40HC, HC…) — a plain 40 is read as 40HC; only 40GP is a standard box</li>
          <li><strong>Vessel Arrival Date</strong> or <strong>Port Arrival Date</strong> — Excel dates, or DD/MM/YYYY</li>
          <li><strong>Free Days</strong> — charged as given; the line&rsquo;s standard is used when missing</li>
          <li><strong>Line</strong> — optional; rows without it use the line picked below</li>
        </ul>
        <p className="text-xs">Other columns (last free day, today, demurrage amount…) are ignored. You&rsquo;ll see a preview before anything is saved.</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1.5 sm:w-64">
          <Label>Shipping line for this file *</Label>
          <Select value={line} onValueChange={setLine} disabled={!!repLine}>
            <SelectTrigger><SelectValue placeholder="Pick the line" /></SelectTrigger>
            <SelectContent>
              {lineOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  {code} · {hasDemurrageRules(code) ? `${DEMURRAGE_RULES[code].freeDays} free days standard` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={!line || loading || importing}
          className="bg-maritime hover:bg-maritime/90"
        >
          {loading ? <><Upload className="h-4 w-4 mr-2 animate-spin" />Reading…</> : <><FileSpreadsheet className="h-4 w-4 mr-2" />Choose Excel file</>}
        </Button>
      </div>

      {loaded && parsed && checks && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">Preview · {loaded.fileName}</div>
              <div className="text-sm text-muted-foreground">
                {plural(parsed.records.length, "container")} ready
                {checks.onFile.length > 0 && ` (${checks.onFile.length} already on file will be updated)`}
                {parsed.errors.length > 0 && ` · ${plural(parsed.errors.length, "row")} can't be imported`}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={reset} disabled={importing} aria-label="Cancel import">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {checks.groups.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Vessel arrival</TableHead>
                    <TableHead>Free days</TableHead>
                    <TableHead>Last free day</TableHead>
                    <TableHead className="text-right">Containers</TableHead>
                    <TableHead className="text-right">Already returned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.groups.map((g) => {
                    const free = Array.from(g.free).sort((a, b) => a - b);
                    return (
                      <TableRow key={`${g.line}${g.arrival}`}>
                        <TableCell>{g.line}</TableCell>
                        <TableCell>{fmtDay(g.arrival)}</TableCell>
                        <TableCell>{free.join(", ")}</TableCell>
                        <TableCell>{free.map((f) => fmtDay(lastFreeDay(g.arrival, f))).join(", ")}</TableCell>
                        <TableCell className="text-right">{g.count}</TableCell>
                        <TableCell className="text-right">{g.returned}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">
                Sizes: {Array.from(checks.sizes.entries()).map(([t, n]) => `${t} × ${n}`).join(", ")}
              </p>
            </div>
          )}

          <div className="space-y-2 text-sm">
            {checks.overdue.length > 0 && (
              <Notice tone="warning">
                {plural(checks.overdue.length, "container")} not yet returned {checks.overdue.length === 1 ? "is" : "are"} already past free time —{" "}
                {checks.overdue.reduce((s, r) => s + r.demurrageUSD, 0).toLocaleString()} USD owed as of today. It will be collected at gate-in.
              </Notice>
            )}
            {checks.returned.length > 0 && (
              <Notice tone="info">
                {plural(checks.returned.length, "container")} {checks.returned.length === 1 ? "was" : "were"} already gated in. Importing doesn&rsquo;t change what was charged at their gate-in.
              </Notice>
            )}
            {checks.mismatched.length > 0 && (
              <Notice tone="warning">
                <div>{plural(checks.mismatched.length, "returned container")} {checks.mismatched.length === 1 ? "was" : "were"} gated in with an arrival date or free days that differ from this list. An admin can correct each one from the container&rsquo;s Edit dialog:</div>
                <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-xs space-y-0.5">
                  {checks.mismatched.map((r) => (
                    <li key={r.container_number}>
                      {r.container_number}: gate recorded {r.recordedArrival ? fmtDay(r.recordedArrival) : fmtDay(r.port_arrival_date)}
                      {r.recordedFreeDays != null ? ` / ${r.recordedFreeDays} free days` : ""} — list says {fmtDay(r.port_arrival_date)} / {r.free_days} free days
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {checks.nonStandard.length > 0 && (
              <Notice tone="warning">
                {plural(checks.nonStandard.length, "container")} {checks.nonStandard.length === 1 ? "has" : "have"} free days different from the line&rsquo;s standard. The file&rsquo;s free days will be charged.
              </Notice>
            )}
            {checks.changed.length > 0 && (
              <Notice tone="info">
                {plural(checks.changed.length, "container")} already on file will change arrival date, free days or line.
              </Notice>
            )}
            {checks.defaultedFree.length > 0 && (
              <Notice tone="info">
                {plural(checks.defaultedFree.length, "row")} had no free days — the line&rsquo;s standard free days were used.
              </Notice>
            )}
            {checks.noSize.length > 0 && (
              <Notice tone="info">
                {plural(checks.noSize.length, "row")} had no size. The size will be taken at gate-in.
              </Notice>
            )}
            {checks.future.length > 0 && (
              <Notice tone="warning">
                {plural(checks.future.length, "container")} {checks.future.length === 1 ? "has" : "have"} an arrival date in the future. Check the dates before importing.
              </Notice>
            )}
            {parsed.duplicates.length > 0 && (
              <Notice tone="info">
                Listed more than once (the last row is used): <span className="font-mono">{parsed.duplicates.join(", ")}</span>
              </Notice>
            )}
          </div>

          {parsed.errors.length > 0 && (
            <div className="space-y-1">
              <div className="text-sm font-medium text-destructive">Can&rsquo;t be imported</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {parsed.errors.map((err) => (
                  <div key={`${err.rowNumber}`} className="text-sm text-muted-foreground bg-destructive/5 p-2 rounded">
                    Row {err.rowNumber}{err.containerNumber ? ` (${err.containerNumber})` : ""}: {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset} disabled={importing}>Cancel</Button>
            <Button
              onClick={() => void confirmImport()}
              disabled={importing || parsed.records.length === 0}
              className="bg-maritime hover:bg-maritime/90"
            >
              {importing ? "Importing…" : `Import ${plural(parsed.records.length, "container")}`}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 text-success text-sm">
            <CheckCircle className="h-4 w-4" /> {plural(result.containers, "container")} imported.
          </div>
          {result.errors.map((err) => (
            <div key={err} className="text-sm text-muted-foreground bg-destructive/5 p-2 rounded">{err}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const Notice = ({ tone, children }: { tone: "warning" | "info"; children: React.ReactNode }) => (
  <div
    className={
      tone === "warning"
        ? "flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5"
        : "flex gap-2 rounded-md border bg-muted/40 p-2.5"
    }
  >
    {tone === "warning" ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" /> : <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />}
    <div className="min-w-0">{children}</div>
  </div>
);
