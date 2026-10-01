import { useState } from "react";
import { DateInput } from "@/components/DateInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Anchor, Plus, Upload, FileSpreadsheet } from "lucide-react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { SHIPPING_LINES } from "@/lib/shippingLines";
import { useYards } from "@/hooks/useYards";
import { CONTAINER_NUMBER_REGEX, CONTAINER_NUMBER_MESSAGE } from "@/lib/validation";
import { CONTAINER_TYPES } from "@/lib/containerTypes";
import { DEMURRAGE_RULES, hasDemurrageRules, lastFreeDay, tiersForFreeDays, toDemurrageContainerType } from "@/lib/demurrage";
import { PageHeader } from "@/components/PageHeader";
import { usePortList } from "@/hooks/usePortList";
import { PortListImport } from "@/components/port-data/PortListImport";
import { PortListTable } from "@/components/port-data/PortListTable";
import { fmtDay } from "@/components/port-data/format";

const getErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback;
};

// Lines with a demurrage formula — the only ones that need port data.
const CHARGED_LINES = SHIPPING_LINES.filter((l) => hasDemurrageRules(l));

const portDataSchema = z.object({
  containerNumber: z.string().trim().min(1, "Container number is required").regex(CONTAINER_NUMBER_REGEX, CONTAINER_NUMBER_MESSAGE),
  shippingLine: z.enum(SHIPPING_LINES as unknown as [string, ...string[]]),
  containerType: z.string().min(1, "Container size is required"),
  portArrivalDate: z.string().min(1, "Port arrival date is required"),
  // An empty box must not coerce to 0 free days.
  freeDays: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : Number(v)),
    z.number({ required_error: "Free days are required", invalid_type_error: "Free days must be a number" })
      .int("Free days must be a whole number")
      .min(0, "Free days can't be negative")
      .max(365, "Free days can't be more than 365"),
  ),
});

const PortDemurrageData = () => {
  const { user, profile, isSuperAdmin, isLineRep, currentYardId } = useAuth();
  const { nameOf: yardName } = useYards();
  const superAdmin = isSuperAdmin();
  const scopedYardId = currentYardId(); // null for super_admin viewing "all yards"
  // Line reps are locked to their own shipping line (RLS enforces it server-side
  // too; the lock here just keeps the UI honest).
  const lineRep = isLineRep();
  const repLine = lineRep ? profile?.shipping_line ?? null : null;

  // For super admin without a yard, imports/inserts are fanned out across every yard.
  // If super_admin has picked a specific yard from the switcher, only write to that one.
  const fetchTargetYardIds = async (): Promise<string[]> => {
    if (superAdmin && scopedYardId) return [scopedYardId];
    if (profile?.yard_id && !superAdmin) return [profile.yard_id];
    if (profile?.yard_id && superAdmin) {
      const { data } = await supabase.from("yards").select("id");
      const ids = (data ?? []).map((y) => y.id);
      return ids.length ? ids : [profile.yard_id];
    }
    const { data, error } = await supabase.from("yards").select("id");
    if (error) throw error;
    return (data ?? []).map((y) => y.id);
  };
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultLine = repLine ?? "WOM";
  const emptyForm = () => ({
    containerNumber: "",
    shippingLine: defaultLine,
    containerType: "",
    portArrivalDate: "",
    freeDays: hasDemurrageRules(defaultLine) ? String(DEMURRAGE_RULES[defaultLine].freeDays) : "",
  });
  const [formData, setFormData] = useState(emptyForm);
  // The selected line's demurrage formula (null when the line isn't charged).
  const selectedLineRule = hasDemurrageRules(formData.shippingLine)
    ? DEMURRAGE_RULES[formData.shippingLine]
    : null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: portList = [], isLoading } = usePortList(scopedYardId);

  const setLine = (line: string) =>
    setFormData((f) => ({
      ...f,
      shippingLine: line,
      // Follow the new line's standard unless someone typed their own figure.
      freeDays:
        hasDemurrageRules(f.shippingLine) && f.freeDays !== String(DEMURRAGE_RULES[f.shippingLine].freeDays)
          ? f.freeDays
          : hasDemurrageRules(line) ? String(DEMURRAGE_RULES[line].freeDays) : "",
    }));

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = portDataSchema.safeParse(
      repLine ? { ...formData, shippingLine: repLine } : formData,
    );
    if (!result.success) {
      toast({ title: "Validation Error", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }
    if (!hasDemurrageRules(result.data.shippingLine)) {
      toast({
        title: "No demurrage for this line",
        description: `${result.data.shippingLine} isn't charged demurrage — no port data is needed. Gate the container in directly.`,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const yardIds = await fetchTargetYardIds();
      if (yardIds.length === 0) {
        toast({ title: "Error", description: "No yard available to write port data", variant: "destructive" });
        setIsSubmitting(false);
        return;
      }
      const rows = yardIds.map((yid) => ({
        container_number: result.data.containerNumber,
        shipping_line: result.data.shippingLine,
        container_type: result.data.containerType,
        port_arrival_date: result.data.portArrivalDate,
        free_days: result.data.freeDays,
        daily_demurrage: 0, // unused; the line's tiers set the rate
        last_source: "manual",
        yard_id: yid,
      }));
      const { error } = await supabase
        .from("container_port_data")
        .upsert(rows, { onConflict: "container_number,yard_id" });
      if (error) throw error;

      toast({
        title: "Success",
        description: `Port data saved for ${result.data.containerNumber}${yardIds.length > 1 ? ` across ${yardIds.length} yards` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["container_port_data"] });
      setFormData(emptyForm());
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error, "Failed to save port data"), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const freeDaysNum = Number.parseInt(formData.freeDays, 10);
  const previewTiers = selectedLineRule
    ? tiersForFreeDays(formData.shippingLine as keyof typeof DEMURRAGE_RULES, Number.isNaN(freeDaysNum) ? null : freeDaysNum)
    : [];

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Anchor}
        title="Port Demurrage Data"
        subtitle="The lines' port lists: which containers to accept, their arrival dates and free days"
      />

      <Tabs defaultValue="excel" className="w-full">
        <TabsList>
          <TabsTrigger value="excel"><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel Import</TabsTrigger>
          <TabsTrigger value="manual"><Plus className="h-4 w-4 mr-1" /> Manual Entry</TabsTrigger>
        </TabsList>

        <TabsContent value="excel">
          <Card>
            <CardHeader><CardTitle className="flex items-center space-x-2"><Upload className="h-5 w-5" /><span>Import a port list</span></CardTitle></CardHeader>
            <CardContent>
              <PortListImport
                chargedLines={CHARGED_LINES}
                repLine={repLine}
                userId={user?.id}
                resolveYardIds={fetchTargetYardIds}
                scopedYardId={scopedYardId}
                onImported={() => queryClient.invalidateQueries({ queryKey: ["container_port_data"] })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader><CardTitle>Add / Update Port Data</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="containerNumber">Container Number *</Label>
                    <Input id="containerNumber" value={formData.containerNumber} onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value.toUpperCase() })} placeholder="e.g., SEKU1157908" maxLength={11} className="font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shippingLine">Shipping Line *</Label>
                    <Select
                      value={repLine ?? formData.shippingLine}
                      onValueChange={setLine}
                      disabled={!!repLine}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(repLine ? [repLine] : SHIPPING_LINES).map((sl) => (
                          <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="containerType">Container Size *</Label>
                    <Select value={formData.containerType} onValueChange={(v) => setFormData({ ...formData, containerType: v })}>
                      <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                      <SelectContent>
                        {CONTAINER_TYPES.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portArrivalDate">Port Arrival Date *</Label>
                    <DateInput id="portArrivalDate" value={formData.portArrivalDate} onChange={(v) => setFormData({ ...formData, portArrivalDate: v })} />
                  </div>
                  {selectedLineRule && (
                    <div className="space-y-2">
                      <Label htmlFor="freeDays">Free Days *</Label>
                      <Input id="freeDays" type="number" min={0} max={365} step={1} value={formData.freeDays} onChange={(e) => setFormData({ ...formData, freeDays: e.target.value })} />
                      <p className="text-xs text-muted-foreground">
                        {formData.shippingLine} standard: {selectedLineRule.freeDays} days. Use the line&rsquo;s figure for this container if it differs.
                      </p>
                    </div>
                  )}
                </div>

                {/* Demurrage is derived from the line's tiered formula (size-aware),
                    not a manual rate — show what will apply, or that none does. */}
                {selectedLineRule ? (
                  <div className="rounded-lg border border-maritime/30 bg-maritime/5 p-3 text-sm">
                    <div className="font-semibold text-maritime mb-1">
                      {formData.shippingLine} demurrage · {Number.isNaN(freeDaysNum) ? selectedLineRule.freeDays : freeDaysNum} free days
                      {formData.portArrivalDate && !Number.isNaN(freeDaysNum) && ` · last free day ${fmtDay(lastFreeDay(formData.portArrivalDate, freeDaysNum))}`}
                    </div>
                    <div className="text-muted-foreground space-y-0.5">
                      {previewTiers.map((t, i) => {
                        const size = formData.containerType ? toDemurrageContainerType(formData.containerType) : null;
                        const rateText = size
                          ? `$${size === "20FT" ? t.rate20 : t.rate40}/day`
                          : `20ft $${t.rate20} · 40ft $${t.rate40} /day`;
                        return <div key={i}>{t.label}: {rateText}</div>;
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Charged per day held, computed at gate-in.</div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    <strong>{formData.shippingLine}</strong> isn&rsquo;t charged demurrage — no port data is needed. Gate the container in directly.
                  </div>
                )}
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setFormData(emptyForm())}>Clear</Button>
                  <Button type="submit" className="bg-maritime hover:bg-maritime/90" disabled={isSubmitting || !selectedLineRule}>{isSubmitting ? "Saving..." : "Save Port Data"}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PortListTable
        rows={portList}
        loading={isLoading}
        showYard={superAdmin}
        yardName={yardName}
        yardLabel={scopedYardId ? yardName(scopedYardId) : "All yards"}
        generatedBy={profile?.full_name?.trim() || profile?.username?.trim() || "Yard system"}
      />
    </div>
  );
};

export default PortDemurrageData;
