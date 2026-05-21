import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Anchor, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import bgAuth from "@/assets/bg-auth.jpg";

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
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{
        backgroundImage: `url(${bgAuth})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <Anchor className="h-10 w-10 text-white" />
            <h1 className="text-3xl font-bold text-white drop-shadow-md">Container Yard</h1>
          </div>
          <p className="text-white/80 drop-shadow-sm">Secure access to yard management</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Accounts are created by your administrator. Contact them if you don't have one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-username">Username</Label>
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
                <Label htmlFor="signin-password">Password</Label>
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
                className="w-full bg-maritime hover:bg-maritime/90"
                disabled={isLoading}
              >
                <Lock className="h-4 w-4 mr-2" />
                {isLoading ? "Signing In..." : "Sign In"}
              </Button>
            </form>

            {error && (
              <Alert className="mt-4 border-destructive">
                <AlertDescription className="text-destructive">{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
