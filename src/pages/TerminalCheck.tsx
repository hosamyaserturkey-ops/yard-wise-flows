import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Anchor, CheckCircle2, HelpCircle, Info, Loader2, ShieldAlert, Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CONTAINER_NUMBER_REGEX } from "@/lib/validation";
import {
  MAX_CONTAINERS_PER_LOOKUP,
  TERMINAL_CHECK_LABELS,
  formatTerminalTime,
  parseContainerNumbers,
  type TerminalCheck as TerminalCheckResult,
} from "@/lib/emptyReturns";
import {
  checkTerminalReturns,
  getPreferredFacility,
  setPreferredFacility,
  type TerminalLookup,
} from "@/lib/terminalCheck";

/**
 * Terminal Check — a standalone lookup against APM Terminals' Empty Container
 * Returns API. Deliberately separate from Gate In: it answers a question about
 * the terminal's records and changes nothing in the yard, so no gate-in,
 * gate-out or demurrage step depends on it.
 *
 * What the API answers is whether a facility still accepts an empty back, not
 * gate events, so an open return is read here as "not handed back yet" and the
 * page says as much rather than presenting it as a confirmed movement.
 */

const STATUS_STYLES: Record<
  TerminalCheckResult["status"],
  { icon: typeof CheckCircle2; className: string }
> = {
  not_returned: { icon: Truck, className: "bg-success/10 border-success/30 text-success" },
  returned: { icon: CheckCircle2, className: "bg-primary/10 border-primary/30 text-primary" },
  unknown: { icon: HelpCircle, className: "bg-warning/10 border-warning/30 text-warning" },
  error: { icon: ShieldAlert, className: "bg-destructive/10 border-destructive/30 text-destructive" },
};

const ResultCard = ({ check, checkedAt }: { check: TerminalCheckResult; checkedAt: string }) => {
  const style = STATUS_STYLES[check.status];
  const Icon = style.icon;
  const { record } = check;

  return (
    <div className={`rounded-md border p-4 space-y-2 ${style.className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono font-semibold">{check.containerNumber}</span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4" />
          {TERMINAL_CHECK_LABELS[check.status]}
        </span>
      </div>
      <p className="text-xs opacity-90">{check.detail}</p>
      {record && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs opacity-90 sm:grid-cols-4">
          {record.returnedAt && (
            <>
              <dt className="font-medium">Gate-in (terminal local)</dt>
              <dd>{formatTerminalTime(record.returnedAt)}</dd>
            </>
          )}
          {record.facilityCode && (
            <>
              <dt className="font-medium">Facility</dt>
              <dd className="font-mono">{record.facilityCode}</dd>
            </>
          )}
          {record.shippingLine && (
            <>
              <dt className="font-medium">Line</dt>
              <dd>{record.shippingLine}</dd>
            </>
          )}
          {record.containerIsoCode && (
            <>
              <dt className="font-medium">ISO type</dt>
              <dd className="font-mono">{record.containerIsoCode}</dd>
            </>
          )}
          {record.sizeType && (
            <>
              <dt className="font-medium">Size / type</dt>
              <dd className="font-mono">{record.sizeType}</dd>
            </>
          )}
          {record.terminalStatus && (
            <>
              <dt className="font-medium">Terminal status</dt>
              <dd>{record.terminalStatus}</dd>
            </>
          )}
          {(record.openFrom || record.openUntil) && (
            <>
              <dt className="font-medium">Return window</dt>
              <dd>{[record.openFrom, record.openUntil].filter(Boolean).join(" → ")}</dd>
            </>
          )}
        </dl>
      )}
      <p className="text-[11px] opacity-70">Checked {new Date(checkedAt).toLocaleString()}</p>
    </div>
  );
};

const TerminalCheck = () => {
  const [containersRaw, setContainersRaw] = useState("");
  const [facility, setFacility] = useState(getPreferredFacility);
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState<TerminalLookup | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const containers = parseContainerNumbers(containersRaw);

  const runCheck = async () => {
    if (loading) return;
    if (containers.length === 0) {
      setInputError("Enter at least one container number.");
      return;
    }
    if (containers.length > MAX_CONTAINERS_PER_LOOKUP) {
      setInputError(`Check at most ${MAX_CONTAINERS_PER_LOOKUP} containers at a time.`);
      return;
    }
    const malformed = containers.find((c) => !CONTAINER_NUMBER_REGEX.test(c));
    if (malformed) {
      setInputError(`"${malformed}" is not a container number (4 letters, 7 digits).`);
      return;
    }

    setInputError(null);
    setLoading(true);
    setPreferredFacility(facility);
    setLookup(await checkTerminalReturns(containers, facility));
    setLoading(false);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 animate-in fade-in-0 duration-300">
      <div className="max-w-3xl mx-auto space-y-6">
        <PageHeader
          icon={Anchor}
          title="Terminal Check"
          subtitle="Ask the terminal whether an empty is still due back"
        />

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>What this check can tell you</AlertTitle>
          <AlertDescription className="text-xs">
            It asks APM Terminals whether the facility still accepts each empty
            back. While a return is open, the container has not been handed back
            there yet. It is not a gate-event feed, so it cannot report the hour
            a box gated in, and this lookup changes nothing in the yard — gate-in
            and gate-out carry on exactly as before.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Look up containers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="containers">
                Container numbers (up to {MAX_CONTAINERS_PER_LOOKUP})
              </Label>
              <Textarea
                id="containers"
                value={containersRaw}
                onChange={(e) => setContainersRaw(e.target.value.toUpperCase())}
                placeholder="MRKU7137914, UACU8175070"
                className="font-mono min-h-24"
              />
              <p className="text-xs text-muted-foreground">
                Separate them with commas, spaces or new lines.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-2 flex-1">
                <Label htmlFor="facility">Facility code</Label>
                <Input
                  id="facility"
                  value={facility}
                  onChange={(e) => setFacility(e.target.value.toUpperCase())}
                  placeholder="e.g., JOAQJ"
                  className="font-mono"
                  maxLength={12}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the terminal configured for this deployment.
                </p>
              </div>
              <Button type="button" onClick={runCheck} disabled={loading}>
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

            {inputError && <p className="text-sm text-destructive">{inputError}</p>}
          </CardContent>
        </Card>

        {lookup && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Result{lookup.checks.length > 1 ? "s" : ""}
              {lookup.facilityCode ? ` · ${lookup.facilityCode}` : ""}
            </h2>
            {lookup.checks.map((check) => (
              <ResultCard
                key={check.containerNumber}
                check={check}
                checkedAt={lookup.checkedAt}
              />
            ))}

            {/* The terminal's answer verbatim. Worth having in reach: when a
                reading comes back inconclusive, this is what says why. */}
            {lookup.raw != null && (
              <details className="rounded-md border bg-card p-3 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  Raw terminal response
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                  {JSON.stringify(lookup.raw, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalCheck;
