import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CONTAINER_NUMBER_REGEX } from "@/lib/validation";
import { renameContainer } from "@/lib/renameContainer";

/**
 * Correct the number of a container that was gated in with a typo.
 *
 * Admin-only and only while the container is in the yard; both rules are
 * enforced by the rename_container RPC, which also refuses when the target
 * number already belongs to another container.
 */
export const RenameContainerDialog = ({
  containerId,
  currentNumber,
  open,
  onOpenChange,
  onRenamed,
}: {
  /** Master containers.id — NOT the visit id. */
  containerId: string;
  currentNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (newNumber: string) => void;
}) => {
  const { toast } = useToast();
  const [newNumber, setNewNumber] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const trimmed = newNumber.trim().toUpperCase();
  const formatValid = CONTAINER_NUMBER_REGEX.test(trimmed);
  const changed = trimmed !== currentNumber;
  const canSubmit = formatValid && changed && reason.trim().length >= 3 && !saving;

  const close = () => {
    setNewNumber("");
    setReason("");
    onOpenChange(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await renameContainer(containerId, trimmed, reason);
      if (!res.ok) {
        // The RPC's messages are written for operators — show them verbatim.
        toast({ title: "Could not rename", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Container renamed",
        description: `${res.oldNumber} is now ${res.newNumber}.`,
      });
      onRenamed(res.newNumber ?? trimmed);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct container number</DialogTitle>
          <DialogDescription>
            Currently <span className="font-mono font-semibold">{currentNumber}</span>. Use this
            when the number was typed wrong at gate-in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-new-number">New container number</Label>
            <Input
              id="rename-new-number"
              value={newNumber}
              onChange={(e) =>
                setNewNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
              placeholder="e.g. MAAU3011780"
              className="font-mono uppercase tracking-wider"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={11}
            />
            {trimmed.length > 0 && !formatValid && (
              <p className="text-xs text-destructive">
                Must be 4 letters followed by 7 digits.
              </p>
            )}
            {formatValid && !changed && (
              <p className="text-xs text-destructive">That is already this container's number.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rename-reason">Reason</Label>
            <Input
              id="rename-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. typo at gate-in"
            />
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              The inspection and its photos, port data, demurrage and the container's history all
              move to the new number. This is recorded in the activity log.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {saving ? "Renaming…" : "Rename container"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
