import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Anchor, Plus, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { z } from "zod";
import * as XLSX from "xlsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SHIPPING_LINES } from "@/lib/shippingLines";

type SpreadsheetRow = Record<string, unknown>;

const getErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback;
};

const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES = {
  containerNumber: ["containernumber", "container", "containerno", "containerid"],
  // "containertype" and "type" handle full codes ("40FT"); "size" handles numeric-only ("40", "20")
  containerType: ["containertype", "type", "containersize"],
  containerSize: ["size"],
  shippingLine: ["shippingline", "line", "shipping"],
  portArrivalDate: ["portarrivaldate", "arrivaldate", "portdate", "arrival", "vesselarrivaldate", "vesselarrival"],
  freeDays: ["freedays", "free", "daysfree"],
  dailyDemurrage: ["dailydemurrage", "demurrage", "dailyrate", "rate"],
  dailyDemurrage20: ["dailydemurrage20", "demurrage20", "rate20", "20rate", "20ftdemurrage", "demurrage20ft"],
  dailyDemurrage40: ["dailydemurrage40", "demurrage40", "rate40", "40rate", "40ftdemurrage", "demurrage40ft"],
  dailyDemurrage45: ["dailydemurrage45", "demurrage45", "rate45", "45rate", "45ftdemurrage", "demurrage45ft"],
} as const;

// Maps common full carrier names (lowercase substrings) to their internal codes.
// Used when the "Line" column contains the full company name instead of the code.
const SHIPPING_LINE_NAME_MAP: Record<string, string> = {
  "sea legend": "SLG",
  "sea lead": "SLD",
  "sealead": "SLD",
  "swift flow": "SFS",
  "swiftflow": "SFS",
  "sea falcon": "SFS",
  "seafalcon": "SFS",
  "medkon": "MDK",
  "baltrans": "BLT",
  "baltic": "BLT",
};

const resolveShippingLine = (raw: string): string => {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if ((SHIPPING_LINES as readonly string[]).includes(upper)) return upper;
  const lower = trimmed.toLowerCase();
  for (const [name, code] of Object.entries(SHIPPING_LINE_NAME_MAP)) {
    if (lower.includes(name)) return code;
  }
  // Try to find any known code as a word-boundary token inside the string
  for (const code of SHIPPING_LINES) {
    const re = new RegExp(`\\b${code}\\b`, "i");
    if (re.test(trimmed)) return code;
  }
  return upper;
};

const getCellByAliases = (row: SpreadsheetRow, aliases: readonly string[]) => {
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    if (aliases.includes(normalizeHeader(key))) {
      return value;
    }
  }
  return undefined;
};

const normalizeContainerType = (value: unknown): string | null => {
  if (value == null) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;
  if (normalized.startsWith("20")) return "20FT";
  if (normalized.startsWith("45")) return "45FT";
  if (normalized.startsWith("40")) {
    if (normalized.includes("HC") || normalized.includes("HIGHCUBE")) return "40HC";
    return "40FT";
  }
  return null;
};

// Resolve container type from a row that may have separate "Size" and "Container Type" columns.
// E.g. Size="40" + Container Type="HC" → "40HC";  Container Type="20FT" alone → "20FT".
const resolveContainerType = (row: SpreadsheetRow): string | null => {
  const typeVal = getCellByAliases(row, HEADER_ALIASES.containerType);
  const sizeVal = getCellByAliases(row, HEADER_ALIASES.containerSize);

  // Both present: combine size prefix + type suffix (handles "40"+"HC" → "40HC")
  if (typeVal != null && sizeVal != null) {
    const combined = String(sizeVal).trim() + String(typeVal).trim();
    const result = normalizeContainerType(combined);
    if (result) return result;
  }
  // Type column alone (may already be a full code like "40FT")
  if (typeVal != null) {
    const result = normalizeContainerType(typeVal);
    if (result) return result;
  }
  // Size column alone (numeric: "40", "20")
  if (sizeVal != null) {
    return normalizeContainerType(sizeVal);
  }
  return null;
};

const parseNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const resolveDailyDemurrage = (row: SpreadsheetRow): number | null => {
  const genericRate = parseNumberOrNull(getCellByAliases(row, HEADER_ALIASES.dailyDemurrage));
  const rate20 = parseNumberOrNull(getCellByAliases(row, HEADER_ALIASES.dailyDemurrage20));
  const rate40 = parseNumberOrNull(getCellByAliases(row, HEADER_ALIASES.dailyDemurrage40));
  const rate45 = parseNumberOrNull(getCellByAliases(row, HEADER_ALIASES.dailyDemurrage45));
  const containerType = resolveContainerType(row);

  if (containerType === "20FT") return rate20 ?? genericRate;
  if (containerType === "45FT") return rate45 ?? rate40 ?? genericRate;
  if (containerType === "40FT" || containerType === "40HC") return rate40 ?? genericRate;

  return genericRate;
};

const portDataSchema = z.object({
  containerNumber: z.string().trim().min(1, "Container number is required").max(20).regex(/^[A-Z0-9]+$/, "Only uppercase letters and numbers"),
  shippingLine: z.enum(SHIPPING_LINES as unknown as [string, ...string[]]),
  portArrivalDate: z.string().min(1, "Port arrival date is required"),
  freeDays: z.coerce.number().int().min(0).max(365),
  dailyDemurrage: z.coerce.number().min(0).max(99999),
});

const PortDemurrageData = () => {
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    containerNumber: "",
    shippingLine: "SLD",
    portArrivalDate: "",
    freeDays: "7",
    dailyDemurrage: "15",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; errors: string[] } | null>(null);

  const { data: portData, isLoading } = useQuery({
    queryKey: ["container_port_data"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_port_data")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = portDataSchema.safeParse(formData);
    if (!result.success) {
      toast({ title: "Validation Error", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const yardId = currentYardId();
      if (!yardId) {
        toast({ title: "Error", description: "No yard assigned to your account", variant: "destructive" });
        setIsSubmitting(false);
        return;
      }
      const { error } = await supabase.from("container_port_data").upsert(
        {
          container_number: result.data.containerNumber,
          shipping_line: result.data.shippingLine,
          port_arrival_date: result.data.portArrivalDate,
          free_days: result.data.freeDays,
          daily_demurrage: result.data.dailyDemurrage,
          last_source: "manual",
          yard_id: yardId,
        },
        { onConflict: "container_number,yard_id" }
      );
      if (error) throw error;

      toast({ title: "Success", description: `Port data saved for ${result.data.containerNumber}` });
      queryClient.invalidateQueries({ queryKey: ["container_port_data"] });
      setFormData({ containerNumber: "", shippingLine: "SLD", portArrivalDate: "", freeDays: "7", dailyDemurrage: "15" });
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error, "Failed to save port data"), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);

    try {
      const yardId = currentYardId();
      if (!yardId) {
        toast({ title: "Error", description: "No yard assigned to your account", variant: "destructive" });
        setImporting(false);
        return;
      }
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet);

      let success = 0;
      const errors: string[] = [];
      const upsertPayload = new Map<
        string,
        {
          container_number: string;
          shipping_line: string;
          port_arrival_date: string;
          free_days: number;
          daily_demurrage: number | null;
          last_source: "excel";
          yard_id: string;
        }
      >();

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rowLabel = `Row ${i + 2}`;
        try {
          const containerNumber = String(getCellByAliases(row, HEADER_ALIASES.containerNumber) ?? "")
            .trim()
            .toUpperCase();
          const shippingLine = resolveShippingLine(
            String(getCellByAliases(row, HEADER_ALIASES.shippingLine) ?? "")
          );
          const portArrivalDate = parseExcelDate(
            getCellByAliases(row, HEADER_ALIASES.portArrivalDate)
          );
          const freeDaysRaw = getCellByAliases(row, HEADER_ALIASES.freeDays);
          const freeDays = Number.parseInt(String(freeDaysRaw ?? "7"), 10);
          const dailyDemurrage = resolveDailyDemurrage(row);

          if (!containerNumber) {
            errors.push(`${rowLabel}: missing container number`);
            continue;
          }
          if (!(SHIPPING_LINES as readonly string[]).includes(shippingLine)) {
            errors.push(`${rowLabel} (${containerNumber}): unrecognized shipping line "${shippingLine}" — expected one of: ${SHIPPING_LINES.join(", ")}`);
            continue;
          }
          if (!portArrivalDate) {
            errors.push(`${rowLabel} (${containerNumber}): invalid or missing port arrival date`);
            continue;
          }

          upsertPayload.set(`${containerNumber}|${yardId}`, {
            container_number: containerNumber,
            shipping_line: shippingLine,
            port_arrival_date: portArrivalDate,
            free_days: Number.isNaN(freeDays) ? 7 : Math.max(0, freeDays),
            daily_demurrage: dailyDemurrage,
            last_source: "excel",
            yard_id: yardId,
          });
        } catch (err: unknown) {
          errors.push(`${rowLabel}: ${getErrorMessage(err, "Unknown row error")}`);
        }
      }

      const records = Array.from(upsertPayload.values());
      const chunkSize = 100;

      for (let start = 0; start < records.length; start += chunkSize) {
        const chunk = records.slice(start, start + chunkSize);
        const { error } = await supabase
          .from("container_port_data")
          .upsert(chunk, { onConflict: "container_number,yard_id" });

        if (error) {
          errors.push(`Batch ${Math.floor(start / chunkSize) + 1}: ${error.message}`);
        } else {
          success += chunk.length;
        }
      }

      setImportResults({ success, errors });
      if (success > 0) {
        toast({ title: "Import Complete", description: `${success} records imported successfully` });
        queryClient.invalidateQueries({ queryKey: ["container_port_data"] });
      }
    } catch (err: unknown) {
      toast({ title: "Import Failed", description: getErrorMessage(err, "Import failed"), variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Anchor className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-foreground">Port Demurrage Data</h1>
      </div>

      <Tabs defaultValue="manual" className="w-full">
        <TabsList>
          <TabsTrigger value="manual"><Plus className="h-4 w-4 mr-1" /> Manual Entry</TabsTrigger>
          <TabsTrigger value="excel"><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel Import</TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <Card>
            <CardHeader><CardTitle>Add / Update Port Data</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="containerNumber">Container Number *</Label>
                    <Input id="containerNumber" value={formData.containerNumber} onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value.toUpperCase() })} placeholder="e.g., SEKU1157908" className="font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shippingLine">Shipping Line *</Label>
                    <Select value={formData.shippingLine} onValueChange={(v) => setFormData({ ...formData, shippingLine: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SHIPPING_LINES.map((sl) => (
                          <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portArrivalDate">Port Arrival Date *</Label>
                    <Input id="portArrivalDate" type="date" value={formData.portArrivalDate} onChange={(e) => setFormData({ ...formData, portArrivalDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="freeDays">Free Days</Label>
                    <Input id="freeDays" type="number" value={formData.freeDays} onChange={(e) => setFormData({ ...formData, freeDays: e.target.value })} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="dailyDemurrage">Daily Demurrage Rate (JOD)</Label>
                    <Input id="dailyDemurrage" type="number" step="0.01" value={formData.dailyDemurrage} onChange={(e) => setFormData({ ...formData, dailyDemurrage: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setFormData({ containerNumber: "", shippingLine: "SLD", portArrivalDate: "", freeDays: "7", dailyDemurrage: "15" })}>Clear</Button>
                  <Button type="submit" className="bg-maritime hover:bg-maritime/90" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Port Data"}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excel">
          <Card>
            <CardHeader><CardTitle className="flex items-center space-x-2"><Upload className="h-5 w-5" /><span>Import from Excel</span></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Upload an Excel or overdue-report file. Accepted column names:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Container #</strong> or <strong>Container Number</strong> — e.g., CULU6254740</li>
                  <li><strong>Size</strong> + <strong>Container Type</strong> — separate columns ("40" + "HC") or combined ("40HC")</li>
                  <li><strong>Line</strong> or <strong>Shipping Line</strong> — full name (e.g., "Sea Lead Shipping") or code ({SHIPPING_LINES.join(", ")})</li>
                  <li><strong>Vessel Arrival Date</strong> or <strong>Port Arrival Date</strong> — DD/MM/YYYY or YYYY-MM-DD</li>
                  <li><strong>free days</strong> — integer (defaults to 7 if missing)</li>
                  <li><strong>Daily Demurrage</strong> — optional; actual billing uses configured tier rules</li>
                </ul>
                <p className="text-xs">Duplicate container numbers in the file keep the last row. Same container in different yards are stored separately.</p>
              </div>
              <div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="hidden" />
                <Button onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-maritime hover:bg-maritime/90">
                  {importing ? <><Upload className="h-4 w-4 mr-2 animate-spin" />Importing...</> : <><FileSpreadsheet className="h-4 w-4 mr-2" />Choose Excel File</>}
                </Button>
              </div>
              {importResults && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-success/10 rounded-lg">
                      <div className="text-2xl font-bold text-success">{importResults.success}</div>
                      <div className="text-sm text-muted-foreground">Imported</div>
                    </div>
                    <div className="p-4 bg-destructive/10 rounded-lg">
                      <div className="text-2xl font-bold text-destructive">{importResults.errors.length}</div>
                      <div className="text-sm text-muted-foreground">Failed</div>
                    </div>
                  </div>
                  {importResults.errors.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {importResults.errors.map((err, i) => (
                        <div key={i} className="text-sm text-muted-foreground bg-destructive/5 p-2 rounded">{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle>Recent Port Data</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !portData?.length ? (
            <p className="text-muted-foreground">No port demurrage data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Shipping Line</TableHead>
                    <TableHead>Port Arrival</TableHead>
                    <TableHead>Free Days</TableHead>
                    <TableHead>Daily Rate</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portData.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.container_number}</TableCell>
                      <TableCell>{row.shipping_line}</TableCell>
                      <TableCell>{new Date(row.port_arrival_date).toLocaleDateString()}</TableCell>
                      <TableCell>{row.free_days}</TableCell>
                      <TableCell>{row.daily_demurrage != null ? `${row.daily_demurrage} JOD` : "—"}</TableCell>
                      <TableCell>{row.last_source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    return null;
  }
  const raw = String(value).trim();

  // Accept common manual formats like DD/MM/YYYY and DD-MM-YYYY
  const dayFirstMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirstMatch) {
    const day = Number.parseInt(dayFirstMatch[1], 10);
    const month = Number.parseInt(dayFirstMatch[2], 10);
    const year = Number.parseInt(dayFirstMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

export default PortDemurrageData;
