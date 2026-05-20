import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, Shield, ShieldCheck, ClipboardCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AppRole = "super_admin" | "admin" | "inspector" | "user";

interface UserRow {
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: AppRole;
  created_at: string;
}

const ROLE_PRIORITY: AppRole[] = ["super_admin", "admin", "inspector", "user"];

const pickHighestRole = (roles: string[]): AppRole => {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return "user";
};

const UserManagement = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Users className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">User Management</h1>
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
                          r.role === "inspector"
                        }
                        onClick={() => toggleRole(r)}
                      >
                        {updatingId === r.user_id
                          ? "Updating…"
                          : r.role === "super_admin" || r.role === "inspector"
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
    </div>
  );
};

export default UserManagement;
