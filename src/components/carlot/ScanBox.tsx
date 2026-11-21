import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFrameReader, type FrameReader } from "@/lib/qr";

/** Why the camera could not start, in words a person can act on. */
function cameraProblem(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked. Allow the camera for this site in the browser's settings, or type the code below.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Type the code below.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again, or type the code below.";
  if (!window.isSecureContext) return "The camera only works on the secure (https) address of the app.";
  return "The camera could not start. Type the code below.";
}

/**
 * A camera that reads QR labels, car tags and (where the phone can) VIN
 * barcodes, plus a box for typing a code or for a hardware scanner that types
 * it and presses Enter. Calls onResult once per code seen; the camera is
 * switched off when this box goes away or is no longer active.
 */
export function ScanBox({ active, onResult, typePlaceholder, hint }: {
  active: boolean;
  onResult: (text: string, how: "scan" | "typed") => void;
  typePlaceholder: string;
  hint: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [reader, setReader] = useState<FrameReader | null>(null);
  const [typed, setTyped] = useState("");
  const lastSeen = useRef<{ text: string; at: number } | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!active || !cameraOn) return;
    let stream: MediaStream | null = null;
    let el: HTMLVideoElement | null = null;
    let timer: number | undefined;
    let stopped = false;
    setProblem(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("no camera API", "NotFoundError");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        // the view is drawn again once an earlier problem is cleared, so look it up now
        el = video.current;
        if (!el) throw new Error("no camera view");
        el.srcObject = stream;
        await el.play().catch(() => undefined);
        const r = await createFrameReader();
        if (stopped) return;
        setReader(r);
        let busy = false;
        const view = el;
        timer = window.setInterval(async () => {
          if (busy || !view.videoWidth) return;
          busy = true;
          try {
            const text = await r.read(view);
            const now = Date.now();
            // the same code stays in view for a while: report it once
            if (text && !(lastSeen.current?.text === text && now - lastSeen.current.at < 2500)) {
              lastSeen.current = { text, at: now };
              navigator.vibrate?.(60);
              onResultRef.current(text, "scan");
            }
          } catch {
            // a frame that could not be read: try the next one
          } finally {
            busy = false;
          }
        }, 180);
      } catch (e) {
        stream?.getTracks().forEach((t) => t.stop());
        if (!stopped) setProblem(cameraProblem(e));
      }
    })();
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (el) el.srcObject = null;
    };
  }, [active, cameraOn]);

  const submitTyped = () => {
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    onResult(t, "typed");
  };

  return (
    <div className="space-y-3">
      {cameraOn && !problem ? (
        <div className="relative overflow-hidden rounded-lg bg-black aspect-[4/3]">
          <video ref={video} playsInline muted className="h-full w-full object-cover" aria-label="Camera view" />
          {/* the frame to aim with */}
          <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          <p className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-center text-sm text-white">
            {hint}{reader ? (reader.native ? " · QR codes and VIN barcodes" : " · QR codes") : ""}
          </p>
        </div>
      ) : problem ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{problem}</p>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitTyped(); } }}
          placeholder={typePlaceholder}
          className="h-12 text-base"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label={typePlaceholder}
        />
        <Button type="button" variant="outline" className="h-12 shrink-0" onClick={submitTyped} disabled={!typed.trim()}>
          <Keyboard className="h-4 w-4 mr-1" /> Use
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setProblem(null); setCameraOn((v) => !v); }}>
        {cameraOn ? <><CameraOff className="h-4 w-4 mr-1" /> Camera off</> : <><Camera className="h-4 w-4 mr-1" /> Camera on</>}
      </Button>
    </div>
  );
}
