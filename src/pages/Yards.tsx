import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, UserPlus } from "lucide-react";

interface Yard { id: string; name: string; code: string; created_at: string; }

const Yards = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [yards, setYards] = useState<Yard[]>([]);
  const [loading, setLoading] = useState(true);
  const [createYardOpen, setCreateYardOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [yardForm, setYardForm] = useState({ name: "", code: "" });
  const [userForm, setUserForm] = useState({ fullName: "", username: "", password: "", yard_id: "", role: "user" as "admin" | "user" | "inspector" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("yards").select("*").order("created_at", { ascending: false });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    setYards(data || []);
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const createYard = async () => {
    if (!user) return;
    if (!yardForm.name.trim() || !yardForm.code.trim()) {
      toast({ title: "Missing fields", variant: "destructive" }); return;
    }
    setBusy(true);
    const { error } = await supabase.from("yards").insert({
      name: yardForm.name.trim(),
      code: yardForm.code.trim().toLowerCase(),
      created_by: user.id,
    });
    setBusy(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Yard created" });
    setCreateYardOpen(false);
    setYardForm({ name: "", code: "" });
    load();
  };

  const createUser = async () => {
    if (!userForm.yard_id) { toast({ title: "Pick a yard", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: {
        username: userForm.username.trim().toLowerCase(),
        password: userForm.password,
        fullName: userForm.fullName.trim(),
        role: userForm.role,
        yard_id: userForm.yard_id,
      },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: "Failed", description: error?.message || (data as { error?: string })?.error, variant: "destructive" });
      return;
    }
    toast({ title: "User created" });
    setCreateUserOpen(false);
    setUserForm({ fullName: "", username: "", password: "", yard_id: "", role: "user" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Building2 className="h-8 w-8 text-white drop-shadow-md" />
          <h1 className="text-3xl font-bold text-white drop-shadow-md">Yards</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateUserOpen(true)} variant="outline">
            <UserPlus className="h-4 w-4 mr-2" /> Create User
          </Button>
          <Button onClick={() => setCreateYardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Yard
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>All Yards</CardTitle></CardHeader>
        <CardContent>
          {loading ? "Loading..." : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Created</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {yards.map(y => (
                  <TableRow key={y.id}>
                    <TableCell>{y.name}</TableCell>
                    <TableCell className="font-mono">{y.code}</TableCell>
                    <TableCell>{new Date(y.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {yards.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No yards yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createYardOpen} onOpenChange={setCreateYardOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Yard</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={yardForm.name} onChange={e => setYardForm({ ...yardForm, name: e.target.value })} /></div>
            <div><Label>Code (unique, short)</Label><Input value={yardForm.code} onChange={e => setYardForm({ ...yardForm, code: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={createYard} disabled={busy}>{busy ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full Name</Label><Input value={userForm.fullName} onChange={e => setUserForm({ ...userForm, fullName: e.target.value })} /></div>
            <div><Label>Username</Label><Input value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} /></div>
            <div><Label>Password</Label><Input type="password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} /></div>
            <div>
              <Label>Yard</Label>
              <Select value={userForm.yard_id} onValueChange={v => setUserForm({ ...userForm, yard_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a yard" /></SelectTrigger>
                <SelectContent>
                  {yards.map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={userForm.role} onValueChange={v => setUserForm({ ...userForm, role: v as "admin" | "user" | "inspector" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Yard Operator</SelectItem>
                  <SelectItem value="inspector">Inspector — mobile only</SelectItem>
                  <SelectItem value="admin">Yard Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createUser} disabled={busy}>{busy ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Yards;
