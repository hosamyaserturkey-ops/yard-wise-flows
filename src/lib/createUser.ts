import { supabase } from "@/integrations/supabase/client";
import { edgeResult } from "@/lib/edgeFunction";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/password";

export { MIN_PASSWORD_LENGTH };

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  role: "admin" | "inspector" | "line_rep" | "user" | "read_only_admin" | "manufacturer_rep";
  /** Every role except manufacturer_rep. */
  yard_id?: string;
  /** manufacturer_rep only. */
  manufacturer_id?: string;
  shipping_line?: string;
}

/**
 * Client-side mirror of the Edge Function's validation, so the user is told
 * what is wrong before a request is made. Returns null when the input is fine.
 */
export function validateNewUser(input: {
  username: string;
  password: string;
  fullName: string;
  role: string;
  shipping_line?: string;
  manufacturer_id?: string;
}): string | null {
  const username = input.username.trim().toLowerCase();
  if (!input.fullName.trim() || !username || !input.password) {
    return "Full name, username and password are required.";
  }
  if (username.length < 3 || !/^[a-z0-9_]+$/.test(username)) {
    return "Username must be at least 3 characters and use only lowercase letters, numbers or underscores.";
  }
  const weakPassword = validatePassword(input.password);
  if (weakPassword) return weakPassword;
  if (input.role === "line_rep" && !input.shipping_line) {
    return "Select which shipping line this representative belongs to.";
  }
  if (input.role === "manufacturer_rep" && !input.manufacturer_id) {
    return "Select which manufacturer this account belongs to.";
  }
  return null;
}

/**
 * Invokes the create-user Edge Function. Returns null on success, or a
 * human-readable reason for the failure.
 */
export async function createUser(input: CreateUserInput): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: {
      username: input.username.trim().toLowerCase(),
      password: input.password,
      fullName: input.fullName.trim(),
      role: input.role,
      // A manufacturer's login has a manufacturer and no yard; everyone else the reverse.
      yard_id: input.role === "manufacturer_rep" ? undefined : input.yard_id,
      manufacturer_id: input.role === "manufacturer_rep" ? input.manufacturer_id : undefined,
      shipping_line: input.role === "line_rep" ? input.shipping_line : undefined,
    },
  });
  return await edgeResult(data, error);
}
