import { supabase } from "@/integrations/supabase/client";
import { usernameToEmail } from "@/lib/auth-utils";
import { edgeResult } from "@/lib/edgeFunction";

/** Mirrors the minimum enforced by the create-user and reset-user-password functions. */
export const MIN_PASSWORD_LENGTH = 10;

/** Returns null when the password is acceptable, or the reason it is not. */
export function validatePassword(password: string): string | null {
  if (!password) return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Changes the signed-in user's own password. Returns null on success, or a
 * human-readable reason for the failure.
 *
 * Supabase does not ask for the current password when updating one, so an
 * unattended session would be enough to lock the owner out. Verify the current
 * password first by signing in with it — that re-issues a session for the same
 * user, so the caller stays signed in either way.
 */
export async function changeOwnPassword(input: {
  username: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<string | null> {
  if (!input.currentPassword) return "Enter your current password.";
  const invalid = validatePassword(input.newPassword);
  if (invalid) return invalid;
  if (input.newPassword !== input.confirmPassword) {
    return "The new passwords do not match.";
  }
  if (input.newPassword === input.currentPassword) {
    return "The new password must differ from the current one.";
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(input.username),
    password: input.currentPassword,
  });
  if (verifyError) return "Current password is incorrect.";

  const { error } = await supabase.auth.updateUser({
    password: input.newPassword,
  });
  if (error) return error.message;
  return null;
}

/**
 * Admin action: sets another user's password via the reset-user-password Edge
 * Function. Returns null on success, or a human-readable reason.
 */
export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<string | null> {
  const invalid = validatePassword(password);
  if (invalid) return invalid;

  const { data, error } = await supabase.functions.invoke("reset-user-password", {
    body: { user_id: userId, password },
  });
  return await edgeResult(data, error);
}
