import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, DollarSign, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const HANDLING_FEE = 7;

interface DemurrageCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  onCollected: () => void;
  chargeableDays: number;
  demurrageAmount: number;
  containerNumber: string;
}

const DemurrageCollectionDialog = ({
  open,
  onClose,
  onCollected,
  chargeableDays,
  demurrageAmount,
  containerNumber,
}: DemurrageCollectionDialogProps) => {
  const [collected, setCollected] = useState(false);
  const totalAmount = demurrageAmount + HANDLING_FEE;

  const handleConfirmCollection = () => {
    onCollected();
    setCollected(false);
  };

  const handleCancel = () => {
    setCollected(false);
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle>Demurrage Payment Required</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              <p>
                Container <span className="font-mono font-semibold">{containerNumber}</span> has
                overdue demurrage that must be collected before gate-in.
              </p>

              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chargeable Days</span>
                  <Badge variant="destructive">{chargeableDays} days</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Demurrage Amount</span>
                  <span className="font-semibold">{demurrageAmount.toLocaleString()} JOD</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Handling Fee</span>
                  <span className="font-semibold">{HANDLING_FEE} JOD</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center">
                  <span className="text-muted-foreground text-sm font-medium">Total to Collect</span>
                  <span className="text-xl font-bold text-destructive">
                    {totalAmount.toLocaleString()} JOD
                  </span>
                </div>
              </div>

              {!collected ? (
                <p className="text-sm text-muted-foreground">
                  Please collect <strong>{totalAmount.toLocaleString()} JOD</strong> in cash from
                  the driver, then mark it as collected below.
                </p>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Cash payment of {totalAmount.toLocaleString()} JOD collected. You may now proceed with gate-in.</span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            Cancel Gate-In
          </Button>
          {!collected ? (
            <Button
              variant="default"
              className="gap-1"
              onClick={() => setCollected(true)}
            >
              <DollarSign className="h-4 w-4" />
              Mark Cash Collected
            </Button>
          ) : (
            <Button
              className="gap-1 bg-green-600 hover:bg-green-700"
              onClick={handleConfirmCollection}
            >
              <CheckCircle2 className="h-4 w-4" />
              Proceed with Gate-In
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export { HANDLING_FEE };
export default DemurrageCollectionDialog;
