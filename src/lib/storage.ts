import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a stored value (an "r2:" key, a storage path, or a legacy public
 * URL) into a displayable URL for the given private bucket. New inspection
 * photos are uploaded to R2 (see Inspector.tsx's uploadPhotos and
 * worker/index.ts) and stored as "r2:<key>"; older photos already in
 * Supabase Storage keep resolving via the signed-URL path below unchanged.
 */
export const resolveSignedUrl = async (
  bucket: string,
  pathOrUrl: string,
  expiresInSeconds = 3600,
): Promise<string | null> => {
  if (!pathOrUrl) return null;

  if (pathOrUrl.startsWith("r2:")) {
    const key = pathOrUrl.slice("r2:".length);
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) return null;
    const res = await fetch(`/api/photos/view?key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    // Guard against the request being answered by the SPA fallback (index.html)
    // instead of the Worker — rendering that as an <img> would show a broken
    // image. Only accept an actual image response.
    const contentType = res.headers.get("Content-Type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

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
