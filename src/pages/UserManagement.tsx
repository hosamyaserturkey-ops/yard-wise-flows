import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, Shield, ShieldCheck, ClipboardCheck, UserPlus, Ship } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SHIPPING_LINES } from "@/lib/shippingLines";

type AppRole = "super_admin" | "admin" | "inspector" | "line_rep" | "user";
type CreatableRole = "admin" | "inspector" | "line_rep" | "user";

interface UserRow {
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: AppRole;
  created_at: string;
}

const ROLE_PRIORITY: AppRole[] = ["super_admin", "admin", "inspector", "line_rep", "user"];

const pickHighestRole = (roles: string[]): AppRole => {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return "user";
};

interface YardOption { id: string; name: string; }

const UserManagement = () => {
  const { toast } = useToast();
  const { user, isSuperAdmin, currentYardId } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [yards, setYards] = useState<YardOption[]>([]);
  const [newUser, setNewUser] = useState<{ fullName: string; username: string; password: string; role: CreatableRole; yard_id: string; shipping_line: string }>({
    fullName: "", username: "", password: "", role: "user", yard_id: "", shipping_line: "",
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, username, created_at")
        .order("created_at", { ascending: false });
      if (pErr) throw pErr;

      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rErr) throw rErr;

      const rolesByUser = new Map<string, string[]>();
      (roles || []).forEach((r: { user_id: string; role: string }) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      });

      setRows(
        (profiles || []).map((p: { user_id: string; full_name: string | null; username: string | null; created_at: string }) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          username: p.username,
          created_at: p.created_at,
          role: pickHighestRole(rolesByUser.get(p.user_id) ?? []),
        }))
      );
    } catch (e: unknown) {
      console.error(e);
      toast({
        title: "Failed to load users",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isSuperAdmin()) {
      supabase.from("yards").select("id, name").order("name").then(({ data }) => {
        setYards(data || []);
      });
    }
  }, [isSuperAdmin]);

  const createUser = async () => {
    if (!newUser.username.trim() || !newUser.password || !newUser.fullName.trim()) {
      toast({ title: "Missing fields", description: "Full name, username and password are required.", variant: "destructive" });
      return;
    }
    const yardId = isSuperAdmin() ? newUser.yard_id : currentYardId();
    if (!yardId) {
      toast({ title: "No yard", description: isSuperAdmin() ? "Please select a yard." : "You are not assigned to a yard.", variant: "destructive" });
      return;
    }
    if (newUser.role === "line_rep" && !newUser.shipping_line) {
      toast({ title: "Missing shipping line", description: "Select which shipping line this representative belongs to.", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: {
        username: newUser.username.trim().toLowerCase(),
        password: newUser.password,
        fullName: newUser.fullName.trim(),
        role: newUser.role,
        yard_id: yardId,
        shipping_line: newUser.role === "line_rep" ? newUser.shipping_line : undefined,
      },
    });
    setCreating(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: "Failed", description: error?.message || (data as { error?: string })?.error, variant: "destructive" });
      return;
    }
    toast({ title: "User created successfully" });
    setCreateOpen(false);
    setNewUser({ fullName: "", username: "", password: "", role: "user", yard_id: "", shipping_line: "" });
    load();
  };

  const toggleRole = async (row: UserRow) => {
    if (row.role !== "admin" && row.role !== "user") return;
    const newRole: "admin" | "user" = row.role === "admin" ? "user" : "admin";
    setUpdatingId(row.user_id);
    try {
      const { data: existing, error: selErr } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", row.user_id)
        .in("role", ["admin", "user"])
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing) {
        const { error } = await supabase
          .from("user_roles")
          .update({ role: newRole })
          .eq("id", existing.id);
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
      console.error(e);
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
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Users className="h-8 w-8 text-maritime" />
          <h1 className="text-3xl font-bold text-industrial">User Management</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> New User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>All Users</span>
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
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell>{r.full_name || "—"}</TableCell>
                    <TableCell>{r.username || "—"}</TableCell>
                    <TableCell>
                      {r.role === "super_admin" ? (
                        <Badge className="bg-warning/30 text-warning border-warning/40">
                          <ShieldCheck className="h-3 w-3 mr-1" /> Super Admin
                        </Badge>
                      ) : r.role === "admin" ? (
                        <Badge className="bg-warning/10 text-warning border-warning/20">
                          <Crown className="h-3 w-3 mr-1" /> Admin
                        </Badge>
                      ) : r.role === "inspector" ? (
                        <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 border-blue-400/30">
                          <ClipboardCheck className="h-3 w-3 mr-1" /> Inspector
                        </Badge>
                      ) : r.role === "line_rep" ? (
                        <Badge variant="secondary" className="bg-teal-500/20 text-teal-600 border-teal-400/30">
                          <Ship className="h-3 w-3 mr-1" /> Line Rep
                        </Badge>
                      ) : (
                        <Badge variant="secondary">User</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          updatingId === r.user_id ||
                          r.user_id === user?.id ||
                          r.role === "super_admin" ||
                          r.role === "inspector" ||
                          r.role === "line_rep"
                        }
                        onClick={() => toggleRole(r)}
                      >
                        {updatingId === r.user_id
                          ? "Updating…"
                          : r.role === "super_admin" || r.role === "inspector" || r.role === "line_rep"
                          ? "Protected"
                          : r.role === "admin"
                          ? "Demote to User"
                          : "Promote to Admin"}
                      </Button>
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
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input value={newUser.fullName} onChange={e => setNewUser({ ...newUser, fullName: e.target.value })} placeholder="First and last name" />
            </div>
            <div className="space-y-1">
              <Label>Username</Label>
              <Input value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value.toLowerCase() })} placeholder="login username" />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="temporary password" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={newUser.role} onValueChange={v => setNewUser({ ...newUser, role: v as CreatableRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isSuperAdmin() && <SelectItem value="admin">Yard Admin</SelectItem>}
                  <SelectItem value="inspector">Inspector</SelectItem>
                  <SelectItem value="line_rep">Shipping Line Representative</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newUser.role === "line_rep" && (
              <div className="space-y-1">
                <Label>Shipping Line</Label>
                <Select value={newUser.shipping_line} onValueChange={v => setNewUser({ ...newUser, shipping_line: v })}>
                  <SelectTrigger><SelectValue placeholder="Select shipping line" /></SelectTrigger>
                  <SelectContent>
                    {SHIPPING_LINES.map(sl => <SelectItem key={sl} value={sl}>{sl}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The representative will only see containers, port data and demurrage of this line.</p>
              </div>
            )}
            {isSuperAdmin() && (
              <div className="space-y-1">
                <Label>Yard</Label>
                <Select value={newUser.yard_id} onValueChange={v => setNewUser({ ...newUser, yard_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                  <SelectContent>
                    {yards.map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={creating}>
              {creating ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
