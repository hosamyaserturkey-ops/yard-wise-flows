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
import { useToast } from "@/hooks/use-toast";
import type { Container } from "@/types/container";
import { adminDeleteContainer } from "@/lib/adminEdit";
import { formatDateTime } from "@/lib/format";

const MIN_REASON = 3;

/**
 * Admin removal of a container gated in by mistake. Only offered while the
 * container is in the yard; the admin_delete_container RPC checks that again,
 * refuses a trip with demurrage on file, and logs the deleted record.
 */
export const DeleteContainerDialog = ({
  container,
  otherVisits,
  open,
  onOpenChange,
  onDeleted,
}: {
  container: Container;
  /** Earlier trips of the same container. They are kept, and so is the container row. */
  otherVisits: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) => {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    setReason("");
    onOpenChange(false);
  };

  const confirm = async () => {
    if (reason.trim().length < MIN_REASON) return;
    setDeleting(true);
    try {
      const res = await adminDeleteContainer(container.id, reason);
      if (!res.ok) {
        toast({ title: "Could not delete", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: `${container.containerNumber} deleted`,
        description: "Recorded in the activity log.",
      });
      close();
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete <span className="font-mono">{container.containerNumber}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                This removes ticket #{container.ticketNumber}, gated in {formatDateTime(container.gateInTime)}, from
                the yard, the map and the counts.{" "}
                {otherVisits === 0
                  ? "It is this container's only visit, so the container is removed from the system too."
                  : `Its ${otherVisits} earlier visit${otherVisits === 1 ? " is" : "s are"} kept.`}
                {container.status === "reserved" && container.bookingNumber
                  ? ` Its reservation for booking ${container.bookingNumber} goes with it.`
                  : ""}
              </p>
              <p>
                The inspection and port data are kept. An approved inspection goes back to Awaiting Gate-In, where
                you can cancel it if the container isn&rsquo;t coming in. A copy of the deleted record is saved in
                the activity log.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason — e.g. gated in by mistake, truck turned away"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">A reason is required.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Hold the dialog open until the delete resolves.
              e.preventDefault();
              void confirm();
            }}
            disabled={deleting || reason.trim().length < MIN_REASON}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete container"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
