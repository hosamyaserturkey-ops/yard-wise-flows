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
import type { Booking } from "@/types/booking";
import { fetchShippingLines, type ShippingLineRow } from "@/lib/shippingLines";
import {
  adminEditBooking,
  describeChange,
  diffEdits,
  type BookingEditField,
  type EditValue,
} from "@/lib/adminEdit";

type Form = Record<BookingEditField, string>;

const NO_LINE = "__none__";

/**
 * Admin correction of a booking: customer, number, line, container count and
 * status. A reason is required and each change is logged (old → new) by the
 * admin_edit_booking RPC. A new booking number is copied onto its visits too.
 */
export const EditBookingDialog = ({
  booking,
  open,
  onOpenChange,
  onSaved,
}: {
  booking: Booking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const original = useMemo<Form>(
    () => ({
      customer_name: booking.customer_name,
      booking_number: booking.booking_number,
      shipping_line: booking.shipping_line ?? "",
      total_containers: String(booking.total_containers),
      status: booking.status,
    }),
    [booking],
  );
  const [form, setForm] = useState<Form>(original);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<ShippingLineRow[]>([]);

  useEffect(() => {
    if (open) {
      setForm(original);
      setReason("");
    }
  }, [open, original]);

  useEffect(() => {
    if (open && lines.length === 0) fetchShippingLines().then(setLines).catch(() => setLines([]));
  }, [open, lines.length]);

  const edited: Partial<Record<BookingEditField, EditValue>> = {
    ...form,
    total_containers: form.total_containers === "" ? null : Number(form.total_containers),
  };
  const changes = diffEdits<BookingEditField>(
    { ...original, total_containers: booking.total_containers },
    edited,
  );
  const changeCount = Object.keys(changes).length;
  const total = Number(form.total_containers);
  const totalOk = Number.isInteger(total) && total >= Math.max(1, booking.gated_out_containers);
  const canSave = changeCount > 0 && totalOk && reason.trim().length >= 3 && !saving;

  const set = (field: BookingEditField) => (value: string) => setForm((f) => ({ ...f, [field]: value }));
  const lineCodes = Array.from(new Set([...lines.map((l) => l.code), original.shipping_line])).filter(Boolean);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await adminEditBooking(booking.id, changes, reason);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit booking {booking.booking_number}</DialogTitle>
          <DialogDescription>
            Admin correction. Every change is recorded in the activity log with who made it and why.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-customer_name">Customer</Label>
              <Input id="edit-customer_name" value={form.customer_name} onChange={(e) => set("customer_name")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-booking_number">Booking number</Label>
              <Input
                id="edit-booking_number"
                className="font-mono"
                value={form.booking_number}
                onChange={(e) => set("booking_number")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Shipping line</Label>
              <Select
                value={form.shipping_line || NO_LINE}
                onValueChange={(v) => set("shipping_line")(v === NO_LINE ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINE}>—</SelectItem>
                  {lineCodes.map((code) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-total_containers">Containers booked</Label>
              <Input
                id="edit-total_containers"
                type="number"
                min={Math.max(1, booking.gated_out_containers)}
                value={form.total_containers}
                onChange={(e) => set("total_containers")(e.target.value)}
              />
              {!totalOk && (
                <p className="text-xs text-destructive">
                  At least {Math.max(1, booking.gated_out_containers)} ({booking.gated_out_containers} already gated out).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={set("status")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="completed">completed</SelectItem>
                  <SelectItem value="cancelled">cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-booking-reason">Reason for the change *</Label>
            <Textarea
              id="edit-booking-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer name spelled wrong"
              rows={2}
            />
          </div>

          {changeCount > 0 && (
            <Alert>
              <History className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-0.5">
                {Object.entries(changes).map(([field, to]) => (
                  <div key={field}>
                    {describeChange({ field, from: original[field as BookingEditField] || null, to })}
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
