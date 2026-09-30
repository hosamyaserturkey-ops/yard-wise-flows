import {
  DEMURRAGE_RULES,
  tiersForFreeDays,
  toDemurrageContainerType,
  type DemurrageShippingLine,
} from "@/lib/demurrage";

/**
 * Read-only tier rules table for a shipping line with configured rules. With
 * `freeDays` (from the line's port list) the periods shift to match.
 */
export const DemurrageTierRulesTable = ({
  shippingLine,
  containerType,
  freeDays,
}: {
  shippingLine: DemurrageShippingLine;
  containerType?: string;
  freeDays?: number;
}) => {
  const tiers = tiersForFreeDays(shippingLine, freeDays);
  const standard = DEMURRAGE_RULES[shippingLine].freeDays;
  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="bg-muted px-3 py-2 text-sm font-semibold">
        {shippingLine} — Demurrage Tier Rules
        {freeDays != null && freeDays !== standard && (
          <span className="ml-2 font-normal text-muted-foreground">
            ({freeDays} free days from the port list; standard {standard})
          </span>
        )}
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2">Period</th>
            <th className="text-right p-2">20FT (USD/day)</th>
            <th className="text-right p-2">40FT (USD/day)</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => (
            <tr key={i} className="border-t">
              <td className="p-2">{tier.label}</td>
              <td className="p-2 text-right">{tier.rate20 === 0 ? "Free" : `$${tier.rate20}`}</td>
              <td className="p-2 text-right">{tier.rate40 === 0 ? "Free" : `$${tier.rate40}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {containerType && (
        <p className="px-3 py-2 text-xs text-muted-foreground border-t">
          Applied rate column for this container: <strong>{toDemurrageContainerType(containerType)}</strong>
        </p>
      )}
    </div>
  );
};
