import { supabase } from "@/integrations/supabase/client";

/** Mirrors the create-user Edge Function's own minimum. */
export const MIN_PASSWORD_LENGTH = 10;

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
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (input.role === "line_rep" && !input.shipping_line) {
    return "Select which shipping line this representative belongs to.";
  }
  return null;
}

/**
 * supabase-js rejects any non-2xx Edge Function response with the generic
 * "Edge Function returned a non-2xx status code" and keeps the actual
 * response on `error.context`. Read the JSON body so the real reason
 * ("Password must be at least 10 characters", "Username already taken", …)
 * reaches the user instead of that placeholder.
 */
async function edgeErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const message = (body as { error?: string })?.error;
      if (message) return message;
    } catch {
      try {
        const text = (await context.clone().text()).trim();
        if (text) return text;
      } catch {
        /* fall through to the generic message */
      }
    }
  }
  return error instanceof Error ? error.message : "Unknown error";
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
  if (error) return await edgeErrorMessage(error);
  const bodyError = (data as { error?: string } | null)?.error;
  return bodyError ?? null;
}
