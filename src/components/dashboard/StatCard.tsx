import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCountUp } from "@/hooks/useCountUp";

export const StatCard = ({
  label,
  value,
  color,
  icon,
  loading,
}: {
  label: string;
  value: number | string;
  color: string;
  icon: React.ReactNode;
  loading?: boolean;
}) => {
  // Count numeric stats up on mount / change; strings ("—", "5d") render as-is.
  const numeric = typeof value === "number";
  const counted = useCountUp(numeric ? value : 0);

  return (
    <Card
      className={`border-l-4 border-l-${color} transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className={`text-2xl font-bold tabular-nums text-${color}`}>
            {numeric ? counted : value}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
