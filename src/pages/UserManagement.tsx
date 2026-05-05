import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type AppRole = "admin" | "user";

interface UserRow {
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: AppRole;
  created_at: string;
}

const UserManagement = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
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

      const roleMap = new Map<string, AppRole>(
        (roles || []).map((r: any) => [r.user_id, r.role as AppRole])
      );

      setRows(
        (profiles || []).map((p: any) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          username: p.username,
          created_at: p.created_at,
          role: roleMap.get(p.user_id) || "user",
        }))
      );
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Failed to load users",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleRole = async (row: UserRow) => {
    const newRole: AppRole = row.role === "admin" ? "user" : "admin";
    setUpdatingId(row.user_id);
    try {
      const { data: existing, error: selErr } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (selErr) throw selErr;

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
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Failed to update role",
        description: e.message || "Unknown error",
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
                      {r.role === "admin" ? (
                        <Badge className="bg-warning/10 text-warning border-warning/20">
                          <Crown className="h-3 w-3 mr-1" /> Admin
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
                        disabled={updatingId === r.user_id || r.user_id === user?.id}
                        onClick={() => toggleRole(r)}
                      >
                        {updatingId === r.user_id
                          ? "Updating…"
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
