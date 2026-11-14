import { useAuth } from "@/hooks/useAuth";
import { useYards } from "@/hooks/useYards";

/**
 * Whether the yard the user is working in is a car lot. Staff are tied to one
 * yard by their profile; a super admin follows the yard switcher, and "All
 * yards" keeps the container screens (the original app).
 */
export function useYardKind() {
  const { currentYardId, profile } = useAuth();
  const { yards } = useYards();
  const yardId = currentYardId();
  const kind = yardId ? yards.find((y) => y.id === yardId)?.kind ?? null : null;
  const isManufacturer = profile?.role === "manufacturer_rep";
  return { yardId, kind, isCarLot: !isManufacturer && kind === "vehicle" };
}
