import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { vehiclePhotoUrl } from "@/lib/vehiclePhotos";

/**
 * A car photo, fetched with the user's login and shown from memory (a plain
 * <img src> cannot send the login). `failedText` is shown if it cannot load.
 */
export function VehiclePhoto({
  photoId, alt, className, failedText = "Could not load",
}: { photoId: string; alt: string; className?: string; failedText?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    vehiclePhotoUrl(photoId).then((u) => live && setSrc(u), () => live && setFailed(true));
    return () => { live = false; };
  }, [photoId]);
  if (failed) return <div className={cn("flex items-center justify-center p-1 text-center text-xs text-destructive", className)}>{failedText}</div>;
  if (!src) return <div className={cn("flex items-center justify-center", className)}><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return <img src={src} alt={alt} className={cn("object-cover", className)} />;
}
