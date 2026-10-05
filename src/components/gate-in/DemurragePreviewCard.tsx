import { USD_TO_JOD, freeTimeStatus, type DemurrageResult } from "@/lib/demurrage";
import { formatJod } from "@/lib/accounting";
import { formatDate, formatWeekdayDate } from "@/lib/format";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** A date that never wraps mid-way ("Sat, 10 / Oct 2026") on a phone. */
const Day = ({ children }: { children: string }) => <span className="whitespace-nowrap">{children}</span>;

/** Tiered demurrage calculation result — free-days notice or breakdown table. */
export const DemurragePreviewCard = ({
  preview,
  portArrivalDate,
}: {
  preview: DemurrageResult;
  /** Port arrival date (YYYY-MM-DD) the preview was calculated from. */
  portArrivalDate: string;
}) => {
  const status = freeTimeStatus(preview, portArrivalDate);
  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      {preview.totalJOD === 0 ? (
        <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success text-sm">
          <p className="font-medium">
            No demurrage due
            {status.lastFreeDay && <> — free until <Day>{formatWeekdayDate(status.lastFreeDay)}</Day></>}
          </p>
          <p className="text-xs mt-1 text-success/80">
            {status.freeDaysLeft === 0 ? "Last free day" : `${days(status.freeDaysLeft)} left`}
            {" · "}
            {preview.daysElapsed} of {preview.freeDays} free {preview.freeDays === 1 ? "day" : "days"} used since port arrival on{" "}
            <Day>{formatDate(portArrivalDate)}</Day>
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Demurrage Due</p>
              <p className="text-2xl font-bold text-destructive">
                {formatJod(preview.totalJOD)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Subtotal: ${preview.totalUSD.toLocaleString()} USD
            </p>
          </div>

          {status.firstChargedDay && (
            <p className="text-sm text-muted-foreground">
              {status.lastFreeDay
                ? <>Free time ended <Day>{formatWeekdayDate(status.lastFreeDay)}</Day> · </>
                : <>No free days · </>}
              charged from <Day>{formatWeekdayDate(status.firstChargedDay)}</Day> ({days(status.chargedDays)})
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Period</th>
                  <th className="text-right p-2">Days</th>
                  <th className="text-right p-2">Rate (USD/day)</th>
                  <th className="text-right p-2">Subtotal (USD)</th>
                </tr>
              </thead>
              <tbody>
                {preview.breakdown.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{row.period}</td>
                    <td className="p-2 text-right">{row.days}</td>
                    <td className="p-2 text-right">${row.rateUSD}</td>
                    <td className="p-2 text-right">${row.subtotalUSD.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t font-semibold bg-muted/50">
                  <td className="p-2" colSpan={3}>Total (USD)</td>
                  <td className="p-2 text-right">${preview.totalUSD.toLocaleString()}</td>
                </tr>
                <tr className="border-t text-muted-foreground">
                  <td className="p-2" colSpan={3}>Exchange Rate</td>
                  <td className="p-2 text-right">1 USD = {USD_TO_JOD} JOD</td>
                </tr>
                <tr className="border-t font-bold bg-destructive/10 text-destructive">
                  <td className="p-2" colSpan={3}>Total (JOD)</td>
                  <td className="p-2 text-right">{formatJod(preview.totalJOD)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
