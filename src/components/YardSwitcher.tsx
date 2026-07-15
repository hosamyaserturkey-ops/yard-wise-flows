import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useYards } from "@/hooks/useYards";

/**
 * Header dropdown visible only to super_admin. Choosing a yard scopes every
 * page's currentYardId() reads to that yard; "All yards" (null) lets RLS
 * surface every yard's rows.
 */
export function YardSwitcher() {
  const { isSuperAdmin, selectedYardId, setSelectedYardId } = useAuth();
  const { yards } = useYards();
  if (!isSuperAdmin()) return null;

  const value = selectedYardId ?? "__all__";
  return (
    <div className="flex items-center gap-1.5">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(v) => setSelectedYardId(v === "__all__" ? null : v)}
      >
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All yards</SelectItem>
          {yards.map((y) => (
            <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
