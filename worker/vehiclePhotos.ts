// Pure helpers for the car-lot photo routes in worker/index.ts. Kept apart so
// they can be tested without a Workers runtime, and so the rules are in one place.

export const MAX_VEHICLE_PHOTO_BYTES = 5 * 1024 * 1024;

/** What a phone or PC browser sends, and the extension each is stored under. */
export const VEHICLE_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An angle is a short id such as "front_left" or "damage". */
export const ANGLE_PATTERN = /^[a-z0-9_]{1,40}$/;
export const MAX_NOTE_LENGTH = 500;

/** Returns a message when the file may not be stored, else null. */
export function checkVehiclePhoto(contentType: string, byteLength: number): string | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!(type in VEHICLE_PHOTO_TYPES)) return "Only JPEG, PNG, WebP or HEIC photos are accepted.";
  if (byteLength <= 0) return "The photo is empty.";
  if (byteLength > MAX_VEHICLE_PHOTO_BYTES) return "The photo is larger than 5 MB.";
  return null;
}

export function photoExtension(contentType: string): string {
  return VEHICLE_PHOTO_TYPES[contentType.split(";")[0].trim().toLowerCase()] ?? "jpg";
}

/**
 * The object key: the folder Postgres handed back (manufacturer / vehicle /
 * inspection) plus a random name, so a photo is never overwritten.
 */
export function photoKey(prefix: string, uuid: string, extension: string): string {
  return `${prefix}${uuid}.${extension}`;
}

/** SHA-256 of the bytes the Worker actually stored (never trusted from the phone). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Car-lot staff and manufacturer logins must not reach the container photos
 * bucket: they hold the same role names as container staff, so the role check
 * alone would let them in. A profile counts as car-lot side when it has a
 * manufacturer or its yard is a car lot.
 */
export function isVehicleSideProfile(
  profile: { manufacturer_id: string | null; yards: { kind: string } | null } | null,
): boolean {
  if (!profile) return false;
  return profile.manufacturer_id !== null || profile.yards?.kind === "vehicle";
}
