import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MIN_REASON = 3;

/**
 * Confirm voiding an inspection. Shared by the gate-in queue and the photo
 * archive so both ask for the same thing and word the consequence the same way.
 */
export const CancelInspectionDialog = ({
  containerNumber,
  open,
  onOpenChange,
  onConfirm,
}: {
  /** Null while closed; the dialog reads the number for its title. */
  containerNumber: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) => {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const close = () => {
    setReason("");
    onOpenChange(false);
  };

  const confirm = async () => {
    if (reason.trim().length < MIN_REASON) return;
    setCancelling(true);
    try {
      await onConfirm(reason.trim());
      close();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Cancel inspection for <span className="font-mono">{containerNumber}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from the Awaiting Gate-In queue and it will no longer clear a
            container for gate-in. The record and its photos are kept for the audit trail — use
            this when the container number was typed wrong, or the container was inspected twice.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason — e.g. duplicate, typo, correct number is MAAU3011780"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">A reason is required.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Hold the dialog open until the update resolves.
              e.preventDefault();
              void confirm();
            }}
            disabled={cancelling || reason.trim().length < MIN_REASON}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {cancelling ? "Cancelling…" : "Cancel inspection"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
