import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/photoUpload";

// Car photos are evidence for damage claims, so they are kept sharper than the
// container photos (1600 px, higher quality). Phones send 3 to 8 MB originals;
// this brings them well under the Worker's 5 MB limit.
const EVIDENCE_PHOTO = { maxDimension: 1600, quality: 0.72 } as const;

async function accessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("You are signed out. Sign in again.");
  return session.access_token;
}

/** The message the Worker sent, else a plain one by status. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || `${fallback} (${res.status})`);
}

/**
 * Compress and send one photo. The Worker asks the database (as this user)
 * whether they may add to the inspection, stores the file and records it.
 * Returns the new photo's id.
 */
export async function uploadVehiclePhoto(
  file: File,
  inspectionId: string,
  angle: string,
  note?: string,
): Promise<string> {
  const token = await accessToken();
  const photo = await compressImage(file, EVIDENCE_PHOTO);
  const query = new URLSearchParams({ inspection: inspectionId, angle });
  if (note?.trim()) query.set("note", note.trim());
  const res = await fetch(`/api/vehicle-photos/upload?${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": photo.type || "image/jpeg" },
    body: photo,
  });
  if (!res.ok) throw await failure(res, "Photo upload failed");
  return ((await res.json()) as { id: string }).id;
}

const urlCache = new Map<string, Promise<string>>();

/**
 * A browser URL for a photo row. The image needs the user's login, so it is
 * fetched with it and shown from memory (a plain <img src> cannot send it).
 */
export function vehiclePhotoUrl(photoId: string): Promise<string> {
  let url = urlCache.get(photoId);
  if (!url) {
    url = (async () => {
      const token = await accessToken();
      const res = await fetch(`/api/vehicle-photos/view?id=${encodeURIComponent(photoId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw await failure(res, "Could not load the photo");
      return URL.createObjectURL(await res.blob());
    })();
    url.catch(() => urlCache.delete(photoId));
    urlCache.set(photoId, url);
  }
  return url;
}
