/**
 * supabase-js rejects any non-2xx Edge Function response with the generic
 * "Edge Function returned a non-2xx status code" and keeps the actual
 * response on `error.context`. Read the JSON body so the real reason
 * ("Password must be at least 10 characters", "Username already taken", …)
 * reaches the user instead of that placeholder.
 */
export async function edgeErrorMessage(error: unknown): Promise<string> {
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
 * Normalises an Edge Function result into "null on success, reason on
 * failure" — the function may signal a problem either by status code or by
 * an `error` key in a 2xx body.
 */
export async function edgeResult(
  data: unknown,
  error: unknown,
): Promise<string | null> {
  if (error) return await edgeErrorMessage(error);
  return (data as { error?: string } | null)?.error ?? null;
}
