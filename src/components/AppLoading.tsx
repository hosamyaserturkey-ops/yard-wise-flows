import { cn } from "@/lib/utils";

interface AppLoadingProps {
  /** Cover the whole window (before the layout exists) rather than the page area. */
  fullScreen?: boolean;
  label?: string;
}

/**
 * The app's loading state: a name or label over a thin sliding bar. The
 * full-screen version matches what index.html shows before any JavaScript has
 * run, so handing over from one to the other doesn't flash.
 */
export function AppLoading({ fullScreen = false, label = "Loading…" }: AppLoadingProps) {
  return (
    <div
      role="status"
      aria-label={fullScreen ? "Loading Container Yard" : label}
      className={cn(
        "flex flex-col items-center justify-center gap-3.5 text-foreground",
        fullScreen ? "min-h-dvh bg-background" : "h-[60vh]",
      )}
    >
      {fullScreen ? (
        <span className="text-[15px] font-semibold tracking-tight">Container Yard</span>
      ) : (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
      <span className="block h-[3px] w-40 overflow-hidden rounded-full bg-border">
        <span className="block h-full w-2/5 rounded-full bg-primary animate-boot-slide motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
      </span>
    </div>
  );
}
