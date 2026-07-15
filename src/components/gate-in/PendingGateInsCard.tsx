import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck } from "lucide-react";
import type { PendingGateIn } from "@/types/gateIn";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-green-500", B: "bg-blue-500", C: "bg-yellow-500", D: "bg-red-500",
};

/** Approved-inspection queue shown above the gate-in form. */
export const PendingGateInsCard = ({
  items,
  onSelect,
}: {
  items: PendingGateIn[];
  onSelect: (containerNumber: string) => void;
}) => {
  if (items.length === 0) return null;

  return (
    <Card className="border-green-400 bg-green-50/90">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-green-800 text-base">
          <ClipboardCheck className="h-5 w-5" />
          Awaiting Gate-In — {items.length} container{items.length !== 1 ? "s" : ""} approved
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div
            key={item.container_number}
            className="flex items-center justify-between bg-white rounded-lg border border-green-200 px-4 py-3 cursor-pointer hover:bg-green-50 transition-colors"
            onClick={() => onSelect(item.container_number)}
          >
            <div className="flex items-center gap-3">
              <Badge className={`${GRADE_COLORS[item.grade] ?? "bg-gray-400"} text-white`}>
                {item.grade}
              </Badge>
              <div>
                <div className="font-mono font-semibold text-gray-900">{item.container_number}</div>
                {item.notes && (
                  <div className="text-xs text-gray-500 truncate max-w-[18rem]">{item.notes}</div>
                )}
              </div>
            </div>
            <div className="text-right text-xs text-gray-400 whitespace-nowrap ml-2">
              {new Date(item.inspected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              <div className="text-green-600 font-medium mt-0.5">Tap to select →</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
