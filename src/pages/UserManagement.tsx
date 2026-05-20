import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, Shield, ClipboardCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type ManagedRole = "admin" | "user" | "inspector";

interface UserRow {
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: ManagedRole;
  created_at: string;
}

const ROLE_BADGE = {
  admin: (
    <Badge className="bg-warning/10 text-warning border-warning/20">
      <Crown className="h-3 w-3 mr-1" /> Admin
    </Badge>
  ),
  inspector: (
    <Badge className="bg-blue-500/10 text-blue-600 border-blue-400/20">
      <ClipboardCheck className="h-3 w-3 mr-1" /> Inspector
    </Badge>
  ),
  user: <Badge variant="secondary">User</Badge>,
};

const UserManagement = () => {
  const { toast } = useToast();
  const { user, profile, isSuperAdmin, currentYardId } = useAuth();
  const superAdmin = isSuperAdmin();
  const yardId = currentYardId();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", username: "", password: "", role: "user" as ManagedRole });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("profiles")
        .select("user_id, full_name, username, created_at, yard_id")
        .order("created_at", { ascending: false });

      if (!superAdmin && yardId) {
        query = query.eq("yard_id", yardId);
      }

      const { data: profiles, error: pErr } = await query;
      if (pErr) throw pErr;

      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rErr) throw rErr;

      const roleMap = new Map<string, ManagedRole>(
        (roles || []).map((r: { user_id: string; role: ManagedRole }) => [r.user_id, r.role])
      );

      setRows(
        (profiles || []).map((p) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          username: p.username,
          created_at: p.created_at,
          role: roleMap.get(p.user_id) || "user",
        }))
      );
    } catch (e: unknown) {
      toast({
        title: "Failed to load users",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, superAdmin, yardId]);

  useEffect(() => { load(); }, [load]);

  const createUser = async () => {
    if (!form.username || !form.password || !form.fullName) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }
    if (!yardId && !superAdmin) {
      toast({ title: "No yard assigned to your account", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: {
        username: form.username.trim().toLowerCase(),
        password: form.password,
        fullName: form.fullName.trim(),
        role: form.role,
        yard_id: yardId,
      },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({
        title: "Failed to create user",
        description: error?.message || (data as { error?: string })?.error,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "User created successfully" });
    setCreateOpen(false);
    setForm({ fullName: "", username: "", password: "", role: "user" });
    load();
  };

  const toggleRole = async (row: UserRow) => {
    if (row.role === "admin") return;
    const newRole: ManagedRole = row.role === "user" ? "inspector" : "user";
    setUpdatingId(row.user_id);
    try {
      const { data: existing } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", row.user_id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("user_roles")
          .update({ role: newRole })
          .eq("user_id", row.user_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: row.user_id, role: newRole });
        if (error) throw error;
      }

      setRows((prev) =>
        prev.map((r) => (r.user_id === row.user_id ? { ...r, role: newRole } : r))
      );
      toast({
        title: "Role updated",
        description: `${row.username || row.full_name || "User"} is now ${newRole}`,
      });
    } catch (e: unknown) {
      toast({
        title: "Failed to update role",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Users className="h-8 w-8 text-maritime" />
          <div>
            <h1 className="text-3xl font-bold text-industrial">User Management</h1>
            {!superAdmin && profile?.yard_name && (
              <p className="text-sm text-muted-foreground">Yard: {profile.yard_name}</p>
            )}
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>{superAdmin ? "All Users" : "Yard Users"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell>{r.full_name || "—"}</TableCell>
                    <TableCell className="font-mono">{r.username || "—"}</TableCell>
                    <TableCell>{ROLE_BADGE[r.role] ?? <Badge variant="secondary">User</Badge>}</TableCell>
                    <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      {r.role !== "admin" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updatingId === r.user_id || r.user_id === user?.id}
                          onClick={() => toggleRole(r)}
                        >
                          {updatingId === r.user_id
                            ? "Updating…"
                            : r.role === "user"
                              ? "Make Inspector"
                              : "Make User"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="e.g. Ahmed Al-Rashid"
              />
            </div>
            <div className="space-y-1">
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                placeholder="e.g. ahmed_rashid"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores only</p>
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 6 characters"
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as ManagedRole })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Yard Operator</SelectItem>
                  <SelectItem value="inspector">Inspector — mobile only</SelectItem>
                  {superAdmin && <SelectItem value="admin">Yard Admin</SelectItem>}
                </SelectContent>
              </Select>
              {form.role === "inspector" && (
                <p className="text-xs text-blue-600 mt-1">
                  Inspector accounts can only access the inspection screen on mobile/tablet.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={busy}>
              {busy ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
