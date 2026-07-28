import { useState, useRef } from "react";
import { Camera, CheckCircle, XCircle, ChevronRight, Trash2, ClipboardCheck, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GateMotionOverlay } from "@/components/GateMotionOverlay";
import { uploadPhotoFiles } from "@/lib/photoUpload";

type Grade = "A" | "B" | "C" | "D";
type Decision = "approved" | "rejected";

const GRADE_CONFIG: Record<Grade, { bg: string; ring: string; label: string }> = {
  A: { bg: "bg-success hover:bg-success/90 text-white",       ring: "ring-success",   label: "Excellent" },
  B: { bg: "bg-maritime hover:bg-maritime/90 text-white",     ring: "ring-maritime",  label: "Good"      },
  C: { bg: "bg-warning hover:bg-warning/90 text-white",       ring: "ring-warning",   label: "Fair"      },
  D: { bg: "bg-destructive hover:bg-destructive/90 text-white", ring: "ring-destructive", label: "Poor"    },
};

interface PhotoItem {
  file: File;
  preview: string;
}

const Inspector = () => {
  const { user, profile, currentYardId, signOut } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [containerNumber, setContainerNumber] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ decision: Decision; grade: Grade } | null>(null);
  // Holds the just-completed result while the gate-motion animation plays;
  // `submitted` (the static result screen) is revealed once it finishes.
  const [pendingResult, setPendingResult] = useState<{ decision: Decision; grade: Grade } | null>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const added = files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }));
    setPhotos((prev) => [...prev, ...added].slice(0, 6));
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async (decision: Decision) => {
    if (!grade || !user) return;
    const yardId = currentYardId();
    if (!yardId) {
      toast({ title: "Error", description: "No yard assigned to your account.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let photoUrls: string[] = [];
      try {
        photoUrls = await uploadPhotoFiles(photos.map((p) => p.file));
      } catch {
        toast({ title: "Photo upload failed", description: "Saving without photos.", variant: "destructive" });
      }

      const { error } = await supabase.from("inspector_checks").insert({
        container_number: containerNumber.trim().toUpperCase(),
        grade,
        status: decision,
        notes: notes.trim() || null,
        photo_urls: photoUrls,
        inspector_id: user.id,
        yard_id: yardId,
      });
      if (error) throw error;
      // Play the gate-motion animation first; it reveals the static result
      // screen (setSubmitted) itself once it finishes.
      setPendingResult({ decision, grade });
    } catch (err) {
      console.error(err);
      toast({ title: "Submission failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setContainerNumber("");
    setPhotos([]);
    setGrade(null);
    setNotes("");
    setStep(1);
    setSubmitted(null);
    setPendingResult(null);
  };

  if (pendingResult) {
    const approved = pendingResult.decision === "approved";
    return (
      <GateMotionOverlay
        direction={approved ? "in" : "out"}
        tone={approved ? "default" : "destructive"}
        label={approved ? "Approved" : "Rejected"}
        containerNumber={containerNumber.toUpperCase()}
        onDone={() => {
          setSubmitted(pendingResult);
          setPendingResult(null);
        }}
      />
    );
  }

  if (submitted) {
    const approved = submitted.decision === "approved";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className={`rounded-full p-6 mb-6 ${approved ? "bg-success/15" : "bg-destructive/15"}`}>
          {approved
            ? <CheckCircle className="h-20 w-20 text-success" />
            : <XCircle className="h-20 w-20 text-destructive" />}
        </div>
        <h2 className="text-2xl font-bold mb-2 text-center">
          {approved ? "Container Approved" : "Container Rejected"}
        </h2>
        <p className="text-foreground font-mono text-lg mb-1">{containerNumber.toUpperCase()}</p>
        <p className="text-muted-foreground mb-2">
          Grade: <strong>{submitted.grade}</strong> — {GRADE_CONFIG[submitted.grade].label}
        </p>
        <p className="text-muted-foreground text-sm mb-8">
          {approved
            ? "The operations team can now proceed with gate-in."
            : "This container has been flagged and blocked from gate-in."}
        </p>
        <Button onClick={reset} className="w-full max-w-sm h-14 text-lg">
          Inspect Another Container
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 pt-safe-top pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            <span className="font-semibold">Inspector</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">{profile?.full_name || user?.email}</span>
            <button onClick={signOut} className="text-white/60 hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Step progress bar */}
        <div className="flex gap-1.5 mt-3">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-white" : "bg-white/25"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-white/50 mt-1">Step {step} of 3</p>
      </div>

      <div className="flex-1 p-4 max-w-lg mx-auto w-full">
        {/* Step 1: Container Number */}
        {step === 1 && (
          <div className="space-y-6 pt-4">
            <div>
              <h2 className="text-2xl font-bold mb-1">Container Number</h2>
              <p className="text-muted-foreground text-sm mb-5">Enter the container number to begin the inspection</p>
              <Input
                value={containerNumber}
                onChange={(e) => setContainerNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="e.g. SLDX1234567"
                className="text-xl font-mono h-16 text-center uppercase tracking-widest"
                autoComplete="off"
                inputMode="text"
                autoCapitalize="characters"
              />
            </div>
            <Button
              className="w-full h-14 text-lg"
              disabled={containerNumber.trim().length < 4}
              onClick={() => setStep(2)}
            >
              Continue <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Step 2: Photos + Grade + Notes */}
        {step === 2 && (
          <div className="space-y-7 pt-4">
            {/* Photos */}
            <section>
              <h2 className="text-xl font-bold mb-1">Photos</h2>
              <p className="text-muted-foreground text-sm mb-3">
                Take photos of the container — up to 6
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
              {photos.length < 6 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-28 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors active:bg-muted"
                >
                  <Camera className="h-9 w-9" />
                  <span className="text-sm font-medium">Tap to take photo</span>
                </button>
              )}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {photos.map((photo, i) => (
                    <div key={i} className="relative aspect-square">
                      <img
                        src={photo.preview}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-full object-cover rounded-xl"
                      />
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute top-1.5 right-1.5 bg-destructive text-destructive-foreground rounded-full p-1 shadow"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Grade */}
            <section>
              <h2 className="text-xl font-bold mb-1">Condition Grade</h2>
              <p className="text-muted-foreground text-sm mb-3">Rate the container's overall condition</p>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(GRADE_CONFIG) as Grade[]).map((g) => {
                  const cfg = GRADE_CONFIG[g];
                  const selected = grade === g;
                  return (
                    <button
                      key={g}
                      onClick={() => setGrade(g)}
                      className={`h-24 rounded-2xl text-white font-bold transition-all active:scale-95 ${cfg.bg} ${
                        selected ? `ring-4 ring-offset-2 ${cfg.ring} scale-105` : "opacity-75"
                      }`}
                    >
                      <div className="text-3xl">{g}</div>
                      <div className="text-sm font-normal mt-0.5">{cfg.label}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Notes */}
            <section>
              <h2 className="text-xl font-bold mb-1">
                Notes{" "}
                <span className="text-muted-foreground font-normal text-base">(optional)</span>
              </h2>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Damage details, seal condition, special observations…"
                className="min-h-[90px] text-base"
              />
            </section>

            <Button
              className="w-full h-14 text-lg"
              disabled={!grade}
              onClick={() => setStep(3)}
            >
              Review <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        )}

        {/* Step 3: Review + Approve / Reject */}
        {step === 3 && grade && (
          <div className="space-y-6 pt-4">
            <h2 className="text-2xl font-bold">Confirm Inspection</h2>

            <div className="bg-white rounded-2xl border p-4 space-y-3">
              <Row label="Container" value={<span className="font-mono font-bold">{containerNumber.toUpperCase()}</span>} />
              <Row label="Photos" value={`${photos.length} photo${photos.length !== 1 ? "s" : ""}`} />
              <Row
                label="Grade"
                value={
                  <span className={`inline-block text-white text-sm font-bold px-3 py-1 rounded-full ${GRADE_CONFIG[grade].bg.split(" ")[0]}`}>
                    {grade} — {GRADE_CONFIG[grade].label}
                  </span>
                }
              />
              {notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground">{notes}</p>
                </div>
              )}
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, i) => (
                  <img
                    key={i}
                    src={photo.preview}
                    alt={`Photo ${i + 1}`}
                    className="w-full aspect-square object-cover rounded-xl"
                  />
                ))}
              </div>
            )}

            <div className="space-y-3 pt-2">
              <Button
                className="w-full h-16 text-xl bg-success hover:bg-success/90 active:bg-success/80 text-white"
                disabled={submitting}
                onClick={() => handleSubmit("approved")}
              >
                <CheckCircle className="mr-3 h-6 w-6" />
                {submitting ? "Submitting…" : "Approve Container"}
              </Button>
              <Button
                className="w-full h-16 text-xl bg-destructive hover:bg-destructive/90 active:bg-destructive/80 text-white"
                disabled={submitting}
                onClick={() => handleSubmit("rejected")}
              >
                <XCircle className="mr-3 h-6 w-6" />
                {submitting ? "Submitting…" : "Reject Container"}
              </Button>
              <Button variant="ghost" className="w-full" disabled={submitting} onClick={() => setStep(2)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground text-sm">{label}</span>
    <span className="text-sm">{value}</span>
  </div>
);

export default Inspector;
