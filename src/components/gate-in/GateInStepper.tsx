import { Check } from "lucide-react";

// ── Wizard step indicator ───────────────────────────────────────────────────
const GATE_IN_STEPS = ["Container", "Demurrage", "Transport"];

export const GateInStepper = ({
  step1Done,
  step2Done,
  step3Done,
}: {
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
}) => {
  const doneFlags = [step1Done, step2Done, step3Done];
  const currentStep = doneFlags.findIndex((d) => !d); // first incomplete
  const active = currentStep === -1 ? 3 : currentStep; // 0-indexed, -1 = all done

  return (
    <div className="flex items-center gap-0 mt-3">
      {GATE_IN_STEPS.map((label, i) => {
        const done = doneFlags[i];
        const isCurrent = i === active;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  done
                    ? "bg-success border-success text-white"
                    : isCurrent
                      ? "bg-maritime border-maritime text-white"
                      : "bg-muted border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                  done ? "text-success" : isCurrent ? "text-maritime" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < GATE_IN_STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${
                  done ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
