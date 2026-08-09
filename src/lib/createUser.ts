import { supabase } from "@/integrations/supabase/client";
import { edgeResult } from "@/lib/edgeFunction";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/password";

export { MIN_PASSWORD_LENGTH };

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  role: "admin" | "inspector" | "line_rep" | "user";
  yard_id: string;
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
      yard_id: input.yard_id,
      shipping_line: input.role === "line_rep" ? input.shipping_line : undefined,
    },
  });
  return await edgeResult(data, error);
}
