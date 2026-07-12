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
import { AlertTriangle, DollarSign, CheckCircle2, CreditCard, Banknote } from "lucide-react";
import { useState } from "react";

const SERVICE_FEE = 7;
const YARD_SHARE = 5;
const SHIPPING_LINE_SHARE = 2;

// Per-shipping-line overrides. Splits keep the shipping line share and
// give the remainder to the yard.
const SERVICE_FEE_BY_LINE: Record<string, { total: number; yard: number; shippingLine: number }> = {
  WOM: { total: 5, yard: 3, shippingLine: 2 },
};

export const getServiceFeeConfig = (shippingLine?: string | null) => {
  const override = shippingLine ? SERVICE_FEE_BY_LINE[shippingLine] : undefined;
  if (override) return override;
  return { total: SERVICE_FEE, yard: YARD_SHARE, shippingLine: SHIPPING_LINE_SHARE };
};

interface DemurrageCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  onCollected: (paymentMethod: "cash" | "qlick") => void;
  chargeableDays: number;
  demurrageAmount: number;
  containerNumber: string;
  shippingLine?: string;
}

const DemurrageCollectionDialog = ({
  open,
  onClose,
  onCollected,
  chargeableDays,
  demurrageAmount,
  containerNumber,
  shippingLine,
}: DemurrageCollectionDialogProps) => {
  const [step, setStep] = useState<"info" | "method" | "confirmed">("info");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qlick" | null>(null);
  const serviceFee = getServiceFeeConfig(shippingLine).total;
  const totalAmount = demurrageAmount + serviceFee;

  const handleSelectMethod = (method: "cash" | "qlick") => {
    setPaymentMethod(method);
    setStep("confirmed");
  };

  const handleConfirm = () => {
    if (paymentMethod) {
      onCollected(paymentMethod);
    }
    resetState();
  };

  const handleCancel = () => {
    resetState();
    onClose();
  };

  const resetState = () => {
    setStep("info");
    setPaymentMethod(null);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && step !== "confirmed" && handleCancel()}>
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
                  <span className="text-muted-foreground">Service Fee</span>
                  <span className="font-semibold">{SERVICE_FEE} JOD</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center">
                  <span className="text-muted-foreground text-sm font-medium">Total to Collect</span>
                  <span className="text-xl font-bold text-destructive">
                    {totalAmount.toLocaleString()} JOD
                  </span>
                </div>
              </div>

              {step === "info" && (
                <p className="text-sm text-muted-foreground">
                  Please collect <strong>{totalAmount.toLocaleString()} JOD</strong> from the driver. Choose a payment method below.
                </p>
              )}

              {step === "method" && (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-20 flex-col gap-2 border-2 hover:border-primary"
                    onClick={() => handleSelectMethod("cash")}
                  >
                    <Banknote className="h-6 w-6" />
                    <span>Cash</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-20 flex-col gap-2 border-2 hover:border-primary"
                    onClick={() => handleSelectMethod("qlick")}
                  >
                    <CreditCard className="h-6 w-6" />
                    <span>Qlick</span>
                  </Button>
                </div>
              )}

              {step === "confirmed" && (
                <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    Payment of {totalAmount.toLocaleString()} JOD via {paymentMethod === "cash" ? "Cash" : "Qlick"} confirmed. Proceed with gate-in.
                  </span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            Cancel Gate-In
          </Button>
          {step === "info" && (
            <Button className="gap-1" onClick={() => setStep("method")}>
              <DollarSign className="h-4 w-4" />
              Collect Payment
            </Button>
          )}
          {step === "confirmed" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setStep("method"); setPaymentMethod(null); }}
              >
                Change Method
              </Button>
              <Button
                className="gap-1 bg-green-600 hover:bg-green-700"
                onClick={handleConfirm}
              >
                <CheckCircle2 className="h-4 w-4" />
                Proceed with Gate-In
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export { SERVICE_FEE, YARD_SHARE, SHIPPING_LINE_SHARE };
export default DemurrageCollectionDialog;
