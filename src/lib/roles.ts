import type { AppRole } from "@/hooks/useAuth";

/**
 * The one role the app treats a user as, when they hold several. Highest
 * privilege first. A user with no role row at all is a plain 'user', as before.
 *
 * The two car-lot roles must never fall through to 'user': a manufacturer
 * account would otherwise look like gate staff in the UI.
 */
export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "inspector",
  "line_rep",
  "read_only_admin",
  "manufacturer_rep",
  "user",
];

export function pickRole(roles: readonly string[]): AppRole {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "user";
}
