import { useEffect } from "react";
import { Container, CheckCircle2 } from "lucide-react";

/**
 * A brief celebratory overlay that animates a container driving in through the
 * gate (gate-in) or rolling out (gate-out), then auto-dismisses. Purely
 * decorative — motion is gated behind motion-safe so reduced-motion users just
 * see the confirmation. Click anywhere to dismiss early.
 */
export const GateMotionOverlay = ({
  direction,
  containerNumber,
  onDone,
}: {
  direction: "in" | "out";
  containerNumber: string;
  onDone: () => void;
}) => {
  useEffect(() => {
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [onDone]);

  const isIn = direction === "in";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm animate-in fade-in-0"
      onClick={onDone}
    >
      <div className="relative w-[min(90vw,420px)] overflow-hidden rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-elevated)]">
        {/* Gate scene */}
        <div className="relative mb-4 h-24">
          {/* ground line */}
          <div className="absolute bottom-4 left-0 right-0 h-px bg-border" />
          {/* gate posts */}
          <div className="absolute bottom-4 left-6 h-16 w-1 rounded bg-muted-foreground/30" />
          <div className="absolute bottom-4 right-6 h-16 w-1 rounded bg-muted-foreground/30" />
          {/* the moving container */}
          <div
            className={`absolute bottom-5 left-1/2 -translate-x-1/2 ${
              isIn
                ? "motion-safe:animate-container-in"
                : "motion-safe:animate-container-out"
            }`}
          >
            <div
              className={`flex h-14 w-16 items-center justify-center rounded-lg text-white shadow-lg ${
                isIn ? "bg-maritime" : "bg-muted-foreground"
              }`}
            >
              <Container className="h-8 w-8" />
            </div>
          </div>
        </div>

        <div className="motion-safe:animate-pop-in">
          <CheckCircle2
            className={`mx-auto h-8 w-8 ${isIn ? "text-maritime" : "text-success"}`}
          />
          <p className="mt-2 text-lg font-bold text-foreground">
            {isIn ? "Gated In" : "Gated Out"}
          </p>
          <p className="font-mono text-sm text-muted-foreground">{containerNumber}</p>
        </div>
      </div>
    </div>
  );
};
