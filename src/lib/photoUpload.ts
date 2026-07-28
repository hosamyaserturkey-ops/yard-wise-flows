import { supabase } from "@/integrations/supabase/client";

/**
 * Downscale + re-encode an image client-side before upload (see
 * worker/index.ts's R2 upload route). Non-image files are returned untouched;
 * if the re-encoded file isn't actually smaller, the original is kept.
 */
export const compressImage = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;
  const MAX_DIMENSION = 1024;
  const QUALITY = 0.55;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
};

/**
 * Compress and upload each file to R2 via the Worker's /api/photos/upload
 * route, returning "r2:<key>" strings ready to store in
 * inspector_checks.photo_urls.
 */
export const uploadPhotoFiles = async (files: File[]): Promise<string[]> => {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");

  const paths: string[] = [];
  for (const file of files) {
    const compressed = await compressImage(file);
    const res = await fetch("/api/photos/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": compressed.type,
      },
      body: compressed,
    });
    if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
    const { key } = (await res.json()) as { key: string };
    paths.push(`r2:${key}`);
  }
  return paths;
};
