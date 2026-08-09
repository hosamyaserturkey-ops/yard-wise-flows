import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { changeOwnPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { KeyRound, UserCircle } from "lucide-react";

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

const Account = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.username) {
      toast({
        title: "Account unavailable",
        description: "Your profile is still loading. Try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const failure = await changeOwnPassword({ username: profile.username, ...form });
    setSaving(false);
    if (failure) {
      toast({ title: "Password not changed", description: failure, variant: "destructive" });
      return;
    }
    setForm(EMPTY);
    toast({
      title: "Password changed",
      description: "Use your new password the next time you sign in.",
    });
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={UserCircle}
        title="My Account"
        subtitle={profile?.username ? `Signed in as ${profile.username}` : undefined}
      />

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-4 w-4" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {/* Helps password managers attribute the change to the right login. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={profile?.username ?? ""}
              readOnly
              hidden
            />
            <div className="space-y-1">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={e => setForm({ ...form, currentPassword: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={e => setForm({ ...form, newPassword: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Change Password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Your username is your login name and can only be changed by an administrator.
      </p>
    </div>
  );
};

export default Account;
