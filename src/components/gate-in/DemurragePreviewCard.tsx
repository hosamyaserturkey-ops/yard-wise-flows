import { USD_TO_JOD, type DemurrageResult } from "@/lib/demurrage";

/** Tiered demurrage calculation result — free-days notice or breakdown table. */
export const DemurragePreviewCard = ({ preview }: { preview: DemurrageResult }) => (
  <div className="rounded-md border bg-card p-4 space-y-3">
    {preview.totalJOD === 0 ? (
      <div className="p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-sm">
        ✅ No demurrage due — {Math.max(0, preview.freeDays - preview.daysElapsed)} free day(s) remaining.
        <div className="text-xs mt-1 text-green-600">
          {preview.daysElapsed} day(s) elapsed since port arrival, {preview.freeDays} free.
        </div>
      </div>
    ) : (
      <>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Total Demurrage Due</p>
            <p className="text-2xl font-bold text-destructive">
              {preview.totalJOD.toLocaleString()} JOD
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Subtotal: ${preview.totalUSD.toLocaleString()} USD
          </p>
        </div>

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
                <td className="p-2 text-right">{preview.totalJOD.toLocaleString()} JOD</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    )}
  </div>
);
