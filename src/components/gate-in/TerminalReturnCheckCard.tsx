import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Anchor, CheckCircle2, HelpCircle, Loader2, ShieldAlert, Truck } from "lucide-react";
import { CONTAINER_NUMBER_REGEX } from "@/lib/validation";
import { TERMINAL_CHECK_LABELS, type TerminalCheck } from "@/lib/emptyReturns";
import {
  checkTerminalReturns,
  getPreferredFacility,
  setPreferredFacility,
  type TerminalLookup,
} from "@/lib/terminalCheck";

/**
 * "Has this box been handed back to the terminal yet?" — asked of APM
 * Terminals' Empty Container Returns API for the container currently typed
 * into the gate-in form.
 *
 * The answer is an inference, not a gate event: the API reports whether the
 * terminal still accepts the empty back, so an open return means the box has
 * not gated in there. The card says as much on screen rather than dressing it
 * up as a confirmed movement.
 */

const STATUS_STYLES: Record<
  TerminalCheck["status"],
  { icon: typeof CheckCircle2; className: string }
> = {
  not_returned: { icon: Truck, className: "bg-success/10 border-success/30 text-success" },
  returned: { icon: CheckCircle2, className: "bg-primary/10 border-primary/30 text-primary" },
  unknown: { icon: HelpCircle, className: "bg-warning/10 border-warning/30 text-warning" },
  error: { icon: ShieldAlert, className: "bg-destructive/10 border-destructive/30 text-destructive" },
};

export const TerminalReturnCheckCard = ({ containerNumber }: { containerNumber: string }) => {
  const [facility, setFacility] = useState(getPreferredFacility);
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState<TerminalLookup | null>(null);

  const trimmed = containerNumber.trim().toUpperCase();
  const canCheck = CONTAINER_NUMBER_REGEX.test(trimmed);

  // A result belongs to the number it was fetched for — drop it as soon as
  // the operator types a different container.
  useEffect(() => {
    setLookup((prev) =>
      prev && prev.checks[0]?.containerNumber === trimmed ? prev : null,
    );
  }, [trimmed]);

  const runCheck = async () => {
    if (!canCheck || loading) return;
    setLoading(true);
    setPreferredFacility(facility);
    const result = await checkTerminalReturns([trimmed], facility);
    setLookup(result);
    setLoading(false);
  };

  const check = lookup?.checks[0] ?? null;
  const style = check ? STATUS_STYLES[check.status] : null;
  const Icon = style?.icon ?? HelpCircle;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Anchor className="h-4 w-4" />
          Terminal empty-return check
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Asks APM Terminals whether the empty is still due back at the
          terminal. An open return means the box has not gated in there yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-2 flex-1">
            <Label htmlFor="terminalFacility">Facility code</Label>
            <Input
              id="terminalFacility"
              value={facility}
              onChange={(e) => setFacility(e.target.value.toUpperCase())}
              placeholder="e.g., SEGOT"
              className="font-mono"
              maxLength={12}
            />
          </div>
          <Button type="button" onClick={runCheck} disabled={!canCheck || loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking…
              </>
            ) : (
              "Check terminal"
            )}
          </Button>
        </div>

        {!canCheck && (
          <p className="text-xs text-muted-foreground">
            Enter a full container number above to run the check.
          </p>
        )}

        {check && style && (
          <div className={`rounded-md border p-3 space-y-2 ${style.className}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4" />
              {TERMINAL_CHECK_LABELS[check.status]}
            </div>
            <p className="text-xs opacity-90">{check.detail}</p>
            {check.record && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs opacity-90">
                {check.record.facilityCode && (
                  <>
                    <dt className="font-medium">Facility</dt>
                    <dd className="font-mono">{check.record.facilityCode}</dd>
                  </>
                )}
                {check.record.shippingLine && (
                  <>
                    <dt className="font-medium">Line</dt>
                    <dd>{check.record.shippingLine}</dd>
                  </>
                )}
                {check.record.containerIsoCode && (
                  <>
                    <dt className="font-medium">ISO type</dt>
                    <dd className="font-mono">{check.record.containerIsoCode}</dd>
                  </>
                )}
                {check.record.terminalStatus && (
                  <>
                    <dt className="font-medium">Terminal status</dt>
                    <dd>{check.record.terminalStatus}</dd>
                  </>
                )}
              </dl>
            )}
            <p className="text-[11px] opacity-70">
              Checked {new Date(lookup!.checkedAt).toLocaleString()}
              {lookup!.facilityCode ? ` · ${lookup!.facilityCode}` : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
