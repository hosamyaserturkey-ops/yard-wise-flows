import { useMemo, useState } from "react";
import { usePagination } from "@/hooks/usePagination";
import { TablePager } from "@/components/TablePager";
import { AlertTriangle, Download, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  buildPortListReport,
  portListStatusLabel,
  summarizePortList,
  type PortListRow,
} from "@/lib/portListStatus";
import { fmtDay, todayLocalISO } from "./format";
import { formatDayMonth } from "@/lib/format";
import { formatJod } from "@/lib/accounting";

type StatusFilter = "all" | "awaiting" | "overdue" | "in_yard" | "gated_out" | "mismatch";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "awaiting", label: "Not returned" },
  { value: "overdue", label: "Past free time" },
  { value: "in_yard", label: "In yard" },
  { value: "gated_out", label: "Gated out" },
  { value: "mismatch", label: "Recorded date differs" },
];

// Rendering thousands of rows makes the page sluggish; search or export instead.
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Every container on the yard's port lists and where it stands: not yet
 * returned (and whether it's past free time), in the yard, or gated out. The
 * same view exports to Excel to send back to the line.
 */
export const PortListTable = ({
  rows,
  loading,
  showYard,
  yardName,
  yardLabel,
  generatedBy,
}: {
  rows: PortListRow[];
  loading: boolean;
  showYard: boolean;
  yardName: (id: string | null | undefined) => string;
  yardLabel: string;
  generatedBy: string;
}) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [line, setLine] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [exporting, setExporting] = useState(false);

  const lines = useMemo(() => Array.from(new Set(rows.map((r) => r.shipping_line))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return rows.filter((r) => {
      if (q && !r.container_number.includes(q)) return false;
      if (line !== "all" && r.shipping_line !== line) return false;
      switch (status) {
        case "awaiting": return r.status === "awaiting";
        case "overdue": return r.status === "awaiting" && r.daysOver > 0;
        case "in_yard": return r.status === "in_yard";
        case "gated_out": return r.status === "gated_out";
        case "mismatch": return !!r.recordedArrival || r.recordedFreeDays != null;
        default: return true;
      }
    });
  }, [rows, search, line, status]);

  const summary = useMemo(() => summarizePortList(filtered), [filtered]);
  // The summary cards and the export use the whole filtered list; only the table pages.
  const pager = usePagination(filtered, 50, JSON.stringify([search, line, status]));

  const exportList = async () => {
    setExporting(true);
    try {
      const { downloadReport } = await import("@/lib/reports/workbook");
      const lineLabel = line === "all" ? "All lines" : line;
      const filterLabel = [lineLabel, STATUS_FILTERS.find((f) => f.value === status)?.label, search.trim() && `"${search.trim()}"`]
        .filter(Boolean)
        .join(" · ");
      await downloadReport(
        buildPortListReport(filtered, {
          title: `${line === "all" ? "" : `${line} `}Port List Status`,
          yard: yardLabel,
          generatedBy,
          filter: filterLabel,
          asOf: new Date(),
          fileName: `port-list-${line === "all" ? "all-lines" : line.toLowerCase()}-${todayLocalISO()}.xlsx`,
        }),
      );
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
        <CardTitle>Port List</CardTitle>
        <Button variant="outline" onClick={() => void exportList()} disabled={exporting || filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" /> {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Tile label="Listed" value={summary.listed} />
          <Tile label="Not returned" value={summary.awaiting} />
          <Tile
            label="Past free time"
            value={summary.overdue}
            hint={summary.overdue > 0 ? `${money(summary.overdueUSD)} USD · ${formatJod(summary.overdueJOD)} owed` : undefined}
            tone={summary.overdue > 0 ? "danger" : undefined}
          />
          <Tile label="In yard" value={summary.inYard} />
          <Tile label="Gated out" value={summary.gatedOut} />
        </div>

        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative md:w-64">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search container"
              className="pl-8 font-mono"
            />
          </div>
          <Select value={line} onValueChange={setLine}>
            <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lines</SelectItem>
              {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No port list imported yet.</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground">No containers match.</p>
        ) : (
          <div>
            {/* Scrolls inside its own box so the column headers stay in view. */}
            <Table containerClassName="max-h-[70vh] rounded-md border">
              <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>Container</TableHead>
                  {showYard && <TableHead>Yard</TableHead>}
                  <TableHead>Line</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead className="text-right">Free days</TableHead>
                  <TableHead>Last free day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days over</TableHead>
                  <TableHead className="text-right">Demurrage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.pageItems.map((r) => (
                  <TableRow key={`${r.container_number}-${r.yard_id ?? ""}`}>
                    <TableCell className="font-mono">{r.container_number}</TableCell>
                    {showYard && <TableCell className="text-xs">{yardName(r.yard_id)}</TableCell>}
                    <TableCell>{r.shipping_line}</TableCell>
                    <TableCell>{r.container_type ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDay(r.port_arrival_date)}</TableCell>
                    <TableCell className="text-right">{r.free_days}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDay(r.lastFreeDay)}</TableCell>
                    <TableCell>
                      <StatusBadge row={r} />
                      {(r.recordedArrival || r.recordedFreeDays != null) && (
                        <div className="flex items-center gap-1 text-xs text-warning mt-1">
                          <AlertTriangle className="h-3 w-3" />
                          Gate recorded {r.recordedArrival ? fmtDay(r.recordedArrival) : ""}
                          {r.recordedArrival && r.recordedFreeDays != null ? " / " : ""}
                          {r.recordedFreeDays != null ? `${r.recordedFreeDays} free days` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.daysOver || "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.demurrageUSD > 0 ? (
                        <>
                          <div>${money(r.demurrageUSD)}</div>
                          <div className="text-xs text-muted-foreground">{formatJod(r.demurrageJOD)}</div>
                        </>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager {...pager} noun="containers" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Demurrage counts to today for containers not yet returned, and to the gate-in for returned ones.
        </p>
      </CardContent>
    </Card>
  );
};

const StatusBadge = ({ row }: { row: PortListRow }) => {
  if (row.status === "awaiting") {
    return row.daysOver > 0
      ? <Badge variant="destructive" className="whitespace-nowrap">Past free time</Badge>
      : <Badge variant="outline" className="whitespace-nowrap">Not returned</Badge>;
  }
  const since = row.gateInTime ? formatDayMonth(row.gateInTime) : undefined;
  return (
    <Badge variant={row.status === "in_yard" ? "default" : "secondary"} className="whitespace-nowrap" title={portListStatusLabel(row)}>
      {row.status === "in_yard" ? `In yard · ${since}` : "Gated out"}
    </Badge>
  );
};

const Tile = ({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "danger" }) => (
  <div className={tone === "danger" ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3" : "rounded-lg border bg-muted/30 p-3"}>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={tone === "danger" ? "text-2xl font-bold text-destructive" : "text-2xl font-bold"}>{value.toLocaleString()}</div>
    {hint && <div className="text-xs text-destructive mt-0.5">{hint}</div>}
  </div>
);
