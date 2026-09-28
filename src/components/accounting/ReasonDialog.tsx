import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields shown above the reason. */
  children?: React.ReactNode;
  onCancel: () => void;
  /** Resolve to close the dialog; throw to keep it open (the caller reports the error). */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Every correction to money needs a written reason — it is stored with the
 * change and shown in the Activity log.
 */
export function ReasonDialog({
  open, title, description, confirmLabel, destructive, children, onCancel, onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setReason(""); }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } catch {
      // The caller has already shown the error; keep the dialog open.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {children}
          <div className="space-y-2">
            <Label htmlFor="reason-dialog-reason">Reason *</Label>
            <Textarea
              id="reason-dialog-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being changed? It is recorded in the Activity log."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!reason.trim() || busy}
            onClick={confirm}
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
