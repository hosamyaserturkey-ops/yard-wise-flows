import { Building2 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useYards } from "@/hooks/useYards";

/**
 * A super admin viewing "All yards" has currentYardId() = null until they
 * pick one — which silently breaks any yard-scoped write (Gate In, creating
 * a booking, ...): the insert fails with "no yard assigned" and nothing
 * points them at the actual cause. Renders nothing for non-super-admins
 * (whose yard is fixed) or once a specific yard is selected.
 */
export function YardSelectionGuard({ description }: { description: string }) {
  const { isSuperAdmin, selectedYardId, setSelectedYardId } = useAuth();
  const { yards } = useYards();

  if (!isSuperAdmin() || selectedYardId) return null;

  return (
    <Alert className="border-warning/40 bg-warning/10">
      <Building2 className="h-4 w-4" />
      <AlertTitle>Select a yard to continue</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{description}</p>
        <Select value={selectedYardId ?? undefined} onValueChange={(v) => setSelectedYardId(v)}>
          <SelectTrigger className="w-full max-w-xs bg-background">
            <SelectValue placeholder="Choose a yard…" />
          </SelectTrigger>
          <SelectContent>
            {yards.map((y) => (
              <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AlertDescription>
    </Alert>
  );
}
