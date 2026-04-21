import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

const portDataSchema = z.object({
  containerNumber: z.string().trim().min(1, "Container number is required").max(20).regex(/^[A-Z0-9]+$/, "Only uppercase letters and numbers"),
  shippingLine: z.enum(SHIPPING_LINES as unknown as [string, ...string[]]),
  portArrivalDate: z.string().min(1, "Port arrival date is required"),
  freeDays: z.coerce.number().int().min(0).max(365),
  dailyDemurrage: z.coerce.number().min(0).max(99999),
});

const PortDemurrageData = () => {
  const { user } = useAuth();
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
      const { error } = await supabase.from("container_port_data").upsert(
        {
          container_number: result.data.containerNumber,
          shipping_line: result.data.shippingLine,
          port_arrival_date: result.data.portArrivalDate,
          free_days: result.data.freeDays,
          daily_demurrage: result.data.dailyDemurrage,
          last_source: "manual",
        },
        { onConflict: "container_number" }
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
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet);

      let success = 0;
      const errors: string[] = [];

      for (const row of rows) {
        try {
          const containerNumber = String(row["Container Number"] || row["container_number"] || "").trim().toUpperCase();
          const shippingLine = String(row["Shipping Line"] || row["shipping_line"] || "").trim().toUpperCase();
          const portArrivalDate = parseExcelDate(row["Port Arrival Date"] || row["port_arrival_date"]);
          const freeDays = parseInt(String(row["Free Days"] || row["free_days"] || "7"), 10);
          const dailyDemurrage = parseFloat(String(row["Daily Demurrage"] || row["daily_demurrage"] || "15"));

          if (!containerNumber) { errors.push(`Row missing container number`); continue; }
          if (!(SHIPPING_LINES as readonly string[]).includes(shippingLine)) { errors.push(`${containerNumber}: invalid shipping line "${shippingLine}"`); continue; }
          if (!portArrivalDate) { errors.push(`${containerNumber}: invalid date`); continue; }

          const { error } = await supabase.from("container_port_data").upsert(
            {
              container_number: containerNumber,
              shipping_line: shippingLine,
              port_arrival_date: portArrivalDate,
              free_days: isNaN(freeDays) ? 7 : freeDays,
              daily_demurrage: isNaN(dailyDemurrage) ? 15 : dailyDemurrage,
              last_source: "excel",
            },
            { onConflict: "container_number" }
          );
          if (error) { errors.push(`${containerNumber}: ${error.message}`); continue; }
          success++;
        } catch (err: unknown) {
          errors.push(`Row error: ${getErrorMessage(err, "Unknown row error")}`);
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
                <p>Upload an Excel file with the following columns:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Container Number</strong> — e.g., SEKU1157908</li>
                  <li><strong>Shipping Line</strong> — one of: {SHIPPING_LINES.join(", ")}</li>
                  <li><strong>Port Arrival Date</strong> — date format</li>
                  <li><strong>Free Days</strong> — integer (default 7)</li>
                  <li><strong>Daily Demurrage</strong> — rate in JOD (default 15)</li>
                </ul>
                <p className="text-xs">Column headers can also use snake_case (e.g., container_number).</p>
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
                      <TableCell>{row.daily_demurrage} JOD</TableCell>
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
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

export default PortDemurrageData;
