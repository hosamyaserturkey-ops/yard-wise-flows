import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Anchor, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import bgAuth from "@/assets/bg-auth.jpg";

// Signature accent lifted from the maritime theme's cyan (see --maritime-light).
const CYAN = "hsl(199 89% 64%)";
const GRADIENT_MARITIME = "var(--gradient-maritime)";

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { signIn, user, isInspector } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate(isInspector() ? "/inspector" : "/", { replace: true });
    }
  }, [user, isInspector, navigate]);

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const rawUsername = (formData.get("username") as string).trim().toLowerCase();
    const password = formData.get("password") as string;

    if (!rawUsername || !password) {
      setError("Please fill in all fields.");
      setIsLoading(false);
      return;
    }
    if (!/^[a-z0-9_.-]+$/.test(rawUsername)) {
      setError("Username can only contain letters, digits, '_', '.', '-'.");
      setIsLoading(false);
      return;
    }

    const { error } = await signIn(rawUsername, password);

    if (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 0 || status >= 500) {
        setError(`Sign-in failed: ${error.message}`);
      } else {
        setError("Invalid username or password.");
      }
    } else {
      navigate("/");
    }

    setIsLoading(false);
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-4">
      {/* Backdrop: the yard at dusk */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgAuth})` }}
        aria-hidden
      />
      {/* Maritime navy wash + vignette so the pass reads clearly on any photo */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, hsl(213 78% 9% / 0.92) 0%, hsl(210 80% 16% / 0.82) 45%, hsl(213 78% 8% / 0.95) 100%)",
        }}
        aria-hidden
      />
      {/* Faint yard grid — the ground plan of a container stack */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, hsl(199 89% 70% / 0.6) 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, hsl(199 89% 70% / 0.6) 0 1px, transparent 1px 64px)",
          maskImage: "radial-gradient(ellipse at center, black 35%, transparent 82%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 35%, transparent 82%)",
        }}
        aria-hidden
      />

      {/* The gate pass */}
      <div className="relative z-10 w-full min-w-0 max-w-md animate-fade-up motion-reduce:animate-none">
        {/* Wordmark */}
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className="mb-4 grid h-16 w-16 animate-float place-items-center rounded-2xl ring-1 ring-white/20 motion-reduce:animate-none"
            style={{ backgroundImage: GRADIENT_MARITIME, boxShadow: "var(--shadow-maritime)" }}
          >
            <Anchor className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-black uppercase leading-tight tracking-[0.08em] text-white drop-shadow sm:text-3xl sm:tracking-[0.18em]">
            Container <span style={{ color: CYAN }}>Yard</span>
          </h1>
          <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-white/60 sm:tracking-[0.35em]">
            Secure yard management
          </p>
        </div>

        {/* Pass card */}
        <div
          className="relative overflow-hidden rounded-2xl ring-1 ring-white/15"
          style={{ boxShadow: "var(--shadow-elevated)" }}
        >
          {/* Header band — the gate lane readout */}
          <div
            className="flex items-center justify-between px-5 py-3 font-mono text-[0.68rem] uppercase tracking-widest text-white/90"
            style={{ backgroundImage: GRADIENT_MARITIME }}
          >
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Terminal access
            </span>
            <span className="text-white/70">Gate 01 · Ops</span>
          </div>

          {/* Tear line — this pass is your entry to the yard */}
          <div className="border-t border-dashed border-white/25" />

          {/* Body */}
          <div className="bg-card/95 px-6 py-7 backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-card-foreground">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Accounts are issued by your administrator. Contact them if you need access.
            </p>

            <form onSubmit={handleSignIn} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="signin-username"
                  className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Username
                </Label>
                <Input
                  id="signin-username"
                  name="username"
                  type="text"
                  placeholder="Enter your username"
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="signin-password"
                  className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Password
                </Label>
                <Input
                  id="signin-password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full font-semibold tracking-wide text-white transition hover:brightness-110 active:translate-y-px"
                style={{ backgroundImage: GRADIENT_MARITIME, boxShadow: "var(--shadow-maritime)" }}
                disabled={isLoading}
              >
                <Lock className="mr-2 h-4 w-4" />
                {isLoading ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            {error && (
              <Alert className="mt-4 border-destructive/50 bg-destructive/5">
                <AlertDescription className="text-destructive">{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Container corner castings */}
          <span className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l-2 border-t-2 border-white/25" aria-hidden />
          <span className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r-2 border-t-2 border-white/25" aria-hidden />
          <span
            className="pointer-events-none absolute bottom-2 left-2 h-3 w-3 border-b-2 border-l-2"
            style={{ borderColor: "hsl(199 89% 64% / 0.4)" }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute bottom-2 right-2 h-3 w-3 border-b-2 border-r-2"
            style={{ borderColor: "hsl(199 89% 64% / 0.4)" }}
            aria-hidden
          />
        </div>

        {/* Footer */}
        <p className="mt-6 flex items-center justify-center gap-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.3em] text-white/45">
          <ShieldCheck className="h-3.5 w-3.5" />
          Authorized personnel only
        </p>
      </div>
    </div>
  );
};

export default Auth;
