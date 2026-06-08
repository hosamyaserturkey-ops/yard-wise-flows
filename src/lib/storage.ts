import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a stored value (either a storage path or a legacy public URL) into a
 * short-lived signed URL for the given private bucket.
 */
export const resolveSignedUrl = async (
  bucket: string,
  pathOrUrl: string,
  expiresInSeconds = 3600,
): Promise<string | null> => {
  if (!pathOrUrl) return null;
  let path = pathOrUrl;
  const marker = `/object/public/${bucket}/`;
  const idx = pathOrUrl.indexOf(marker);
  if (idx !== -1) {
    path = pathOrUrl.slice(idx + marker.length);
  } else if (pathOrUrl.startsWith("http")) {
    // Already a signed or external URL — return as-is.
    return pathOrUrl;
  }
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
};
