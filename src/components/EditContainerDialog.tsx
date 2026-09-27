import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Container } from "@/types/container";
import { CONTAINER_TYPES } from "@/lib/containerTypes";
import { fetchShippingLines, type ShippingLineRow } from "@/lib/shippingLines";
import { CONTAINER_NUMBER_REGEX } from "@/lib/validation";
import {
  adminEditContainer,
  describeChange,
  diffEdits,
  toLocalInput,
  type ContainerEditField,
  type EditValue,
} from "@/lib/adminEdit";

type Form = Record<ContainerEditField, string>;

function formFor(c: Container): Form {
  return {
    container_number: c.containerNumber,
    shipping_line: c.shippingLine,
    container_type: c.containerType,
    driver_name: c.driverName,
    truck_number: c.truckNumber,
    gate_in_time: toLocalInput(c.gateInTime),
    yard_block: c.yardBlock ?? "",
    yard_row: c.yardRow ?? "",
    gate_out_driver_name: c.gateOutDriverName ?? "",
    gate_out_truck_number: c.gateOutTruckNumber ?? "",
    gate_out_time: toLocalInput(c.gateOutTime),
    seal_number: c.sealNumber ?? "",
    fees: c.fees != null ? String(c.fees) : "",
  };
}

/**
 * Admin correction of a container and one of its visits: number, line, type,
 * gate-in and gate-out details. Every save needs a reason and is written to
 * the activity log field by field (old → new) by the admin_edit_container RPC.
 */
export const EditContainerDialog = ({
  container,
  open,
  onOpenChange,
  onSaved,
}: {
  container: Container;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const original = useMemo(() => formFor(container), [container]);
  const [form, setForm] = useState<Form>(original);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<ShippingLineRow[]>([]);
  const gatedOut = !!container.gateOutTime;

  useEffect(() => {
    if (open) {
      setForm(original);
      setReason("");
    }
  }, [open, original]);

  useEffect(() => {
    if (open && lines.length === 0) fetchShippingLines().then(setLines).catch(() => setLines([]));
  }, [open, lines.length]);

  // The number is compared in the case it is stored in.
  const edited: Partial<Record<ContainerEditField, EditValue>> = {
    ...form,
    container_number: form.container_number.toUpperCase(),
  };
  const changes = diffEdits<ContainerEditField>(original, edited);
  const changeCount = Object.keys(changes).length;
  const numberOk = CONTAINER_NUMBER_REGEX.test(form.container_number.trim().toUpperCase());
  const canSave = changeCount > 0 && numberOk && reason.trim().length >= 3 && !saving;

  const set = (field: ContainerEditField) => (value: string) => setForm((f) => ({ ...f, [field]: value }));
  const text = (field: ContainerEditField, props: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input id={`edit-${field}`} value={form[field]} onChange={(e) => set(field)(e.target.value)} {...props} />
  );

  // Keep a value that is no longer offered (a retired line, a legacy type) selectable.
  const lineCodes = Array.from(new Set([...lines.map((l) => l.code), original.shipping_line])).filter(Boolean);
  const typeCodes = Array.from(new Set([...CONTAINER_TYPES.map((t) => t.code), original.container_type])).filter(Boolean);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await adminEditContainer(container.id, changes, reason);
      if (!res.ok) {
        toast({ title: "Could not save", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: `${res.changes.length} change${res.changes.length === 1 ? "" : "s"} saved`,
        description: "Recorded in the activity log.",
      });
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {container.containerNumber}</DialogTitle>
          <DialogDescription>
            Admin correction. Every change is recorded in the activity log with who made it and why.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Container</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-container_number">Number</Label>
                {text("container_number", {
                  className: "font-mono uppercase",
                  maxLength: 11,
                  onChange: (e) => set("container_number")(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")),
                })}
                {!numberOk && <p className="text-xs text-destructive">4 letters followed by 7 digits.</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Shipping line</Label>
                <Select value={form.shipping_line} onValueChange={set("shipping_line")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {lineCodes.map((code) => (
                      <SelectItem key={code} value={code}>{code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type / size</Label>
                <Select value={form.container_type} onValueChange={set("container_type")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {typeCodes.map((code) => (
                      <SelectItem key={code} value={code}>
                        {CONTAINER_TYPES.find((t) => t.code === code)?.label ?? code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Gate-in</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-driver_name">Driver</Label>
                {text("driver_name")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-truck_number">Truck</Label>
                {text("truck_number", { className: "uppercase" })}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-gate_in_time">Time</Label>
                {text("gate_in_time", { type: "datetime-local" })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-yard_block">Block</Label>
                  {text("yard_block", { className: "uppercase" })}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-yard_row">Row</Label>
                  {text("yard_row", { className: "uppercase" })}
                </div>
              </div>
            </div>
          </section>

          {gatedOut && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Gate-out</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-gate_out_driver_name">Driver</Label>
                  {text("gate_out_driver_name")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-gate_out_truck_number">Truck</Label>
                  {text("gate_out_truck_number", { className: "uppercase" })}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-gate_out_time">Time</Label>
                  {text("gate_out_time", { type: "datetime-local" })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-seal_number">Seal</Label>
                    {text("seal_number", { className: "uppercase" })}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-fees">Fees (JOD)</Label>
                    {text("fees", { type: "number", min: 0, step: "0.001" })}
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-reason">Reason for the change *</Label>
            <Textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. line entered wrong at gate-in"
              rows={2}
            />
          </div>

          {changeCount > 0 && (
            <Alert>
              <History className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-0.5">
                {Object.entries(changes).map(([field, to]) => (
                  <div key={field}>
                    {describeChange({ field, from: original[field as ContainerEditField] || null, to })}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? "Saving…" : changeCount > 0 ? `Save ${changeCount} change${changeCount === 1 ? "" : "s"}` : "No changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
