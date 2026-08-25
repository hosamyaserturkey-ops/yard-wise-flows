import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CancelInspectionDialog } from "@/components/CancelInspectionDialog";
import { ClipboardCheck, X } from "lucide-react";
import type { PendingGateIn } from "@/types/gateIn";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-success", B: "bg-maritime", C: "bg-warning", D: "bg-destructive",
};

/** Approved-inspection queue shown above the gate-in form. */
export const PendingGateInsCard = ({
  items,
  onSelect,
  canCancel = false,
  onCancel,
}: {
  items: PendingGateIn[];
  onSelect: (item: PendingGateIn) => void;
  /** Admins only — an inspection recorded against a mistyped number can never
   *  be gated in, so without this the entry sits in the queue forever. */
  canCancel?: boolean;
  onCancel?: (item: PendingGateIn, reason: string) => Promise<void>;
}) => {
  const [pendingCancel, setPendingCancel] = useState<PendingGateIn | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <Card className="border-success/40 bg-success/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-success text-base">
            <ClipboardCheck className="h-5 w-5" />
            Awaiting Gate-In — {items.length} container{items.length !== 1 ? "s" : ""} approved
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => (
            <div
              key={item.container_number}
              className="flex items-center justify-between bg-card rounded-lg border border-success/20 px-4 py-3 cursor-pointer hover:bg-success/10 transition-colors"
              onClick={() => onSelect(item)}
            >
              <div className="flex items-center gap-3">
                <Badge className={`${GRADE_COLORS[item.grade] ?? "bg-muted-foreground"} text-white`}>
                  {item.grade}
                </Badge>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-foreground">{item.container_number}</span>
                    {item.container_type && (
                      <Badge variant="outline" className="font-mono text-[0.7rem] px-1.5 py-0">
                        {item.container_type}
                      </Badge>
                    )}
                  </div>
                  {item.notes && (
                    <div className="text-xs text-muted-foreground truncate max-w-[18rem]">{item.notes}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(item.inspected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  <div className="text-success font-medium mt-0.5">Tap to select →</div>
                </div>
                {canCancel && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancel inspection for ${item.container_number}`}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    // The row itself selects the container into the form.
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingCancel(item);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <CancelInspectionDialog
        containerNumber={pendingCancel?.container_number ?? null}
        open={pendingCancel !== null}
        onOpenChange={(o) => !o && setPendingCancel(null)}
        onConfirm={async (reason) => {
          if (pendingCancel && onCancel) await onCancel(pendingCancel, reason);
        }}
      />
    </>
  );
};
