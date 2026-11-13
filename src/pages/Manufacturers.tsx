import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Factory, Plus, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { createUser, validateNewUser, MIN_PASSWORD_LENGTH } from "@/lib/createUser";
import { normalizeManufacturerCode, validateManufacturer, type ManufacturerForm } from "@/lib/manufacturers";

interface Manufacturer {
  id: string;
  yard_id: string;
  code: string;
  name: string;
  contact_email: string | null;
  default_free_days: number;
  active: boolean;
}
interface Login { user_id: string; manufacturer_id: string; username: string | null; full_name: string | null; }
interface LotYard { id: string; name: string; }

const EMPTY_FORM: ManufacturerForm = { code: "", name: "", contact_email: "", default_free_days: "7" };
const EMPTY_LOGIN = { fullName: "", username: "", password: "" };

/** Super admin only: the manufacturers whose cars the car lot stores, and their logins. */
const Manufacturers = () => {
  const { toast } = useToast();
  const [lots, setLots] = useState<LotYard[]>([]);
  const [lotId, setLotId] = useState("");
  const [rows, setRows] = useState<Manufacturer[]>([]);
  const [logins, setLogins] = useState<Login[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Manufacturer | "new" | null>(null);
  const [form, setForm] = useState<ManufacturerForm>(EMPTY_FORM);
  const [loginFor, setLoginFor] = useState<Manufacturer | null>(null);
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN);

  const load = useCallback(async () => {
    setLoading(true);
    const [yardsRes, mfrRes, loginRes] = await Promise.all([
      supabase.from("yards").select("id, name").eq("kind", "vehicle").order("name"),
      supabase.from("manufacturers").select("*").order("name"),
      supabase.from("profiles").select("user_id, manufacturer_id, username, full_name").not("manufacturer_id", "is", null),
    ]);
    const error = yardsRes.error ?? mfrRes.error ?? loginRes.error;
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    const yards = yardsRes.data ?? [];
    setLots(yards);
    setLotId((current) => current || yards[0]?.id || "");
    setRows(mfrRes.data ?? []);
    setLogins((loginRes.data ?? []) as Login[]);
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const shown = rows.filter((m) => m.yard_id === lotId);

  const openForm = (m: Manufacturer | "new") => {
    setEditing(m);
    setForm(m === "new" ? EMPTY_FORM : {
      code: m.code, name: m.name, contact_email: m.contact_email ?? "", default_free_days: String(m.default_free_days),
    });
  };

  const save = async () => {
    const invalid = validateManufacturer(form);
    if (invalid) { toast({ title: "Check the form", description: invalid, variant: "destructive" }); return; }
    if (!lotId) { toast({ title: "No car lot", description: "Create the car-lot yard first.", variant: "destructive" }); return; }
    const values = {
      name: form.name.trim(),
      contact_email: form.contact_email.trim() || null,
      default_free_days: Number(form.default_free_days),
    };
    setBusy(true);
    // A manufacturer's code and yard never change: its cars and photo folders are filed under them.
    const { error } = editing === "new"
      ? await supabase.from("manufacturers").insert({ ...values, yard_id: lotId, code: normalizeManufacturerCode(form.code) })
      : await supabase.from("manufacturers").update(values).eq("id", (editing as Manufacturer).id);
    setBusy(false);
    if (error) {
      toast({
        title: "Not saved",
        description: error.code === "23505" ? "That code is already used in this car lot." : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: editing === "new" ? "Manufacturer added" : "Manufacturer updated" });
    setEditing(null);
    load();
  };

  const setActive = async (m: Manufacturer, active: boolean) => {
    const { error } = await supabase.from("manufacturers").update({ active }).eq("id", m.id);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const addLogin = async () => {
    if (!loginFor) return;
    const input = { ...loginForm, role: "manufacturer_rep", manufacturer_id: loginFor.id };
    const invalid = validateNewUser(input);
    if (invalid) { toast({ title: "Check the form", description: invalid, variant: "destructive" }); return; }
    setBusy(true);
    const failure = await createUser({ ...input, role: "manufacturer_rep" });
    setBusy(false);
    if (failure) { toast({ title: "Failed", description: failure, variant: "destructive" }); return; }
    toast({ title: "Login created", description: `Give the password to ${loginFor.name} yourself; they are not notified.` });
    setLoginFor(null);
    setLoginForm(EMPTY_LOGIN);
    load();
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Factory}
        title="Manufacturers"
        subtitle="The brands whose cars the car lot stores, and their portal logins"
        action={
          <Button onClick={() => openForm("new")} disabled={!lotId}>
            <Plus className="h-4 w-4 mr-1" /> Add manufacturer
          </Button>
        }
      />

      {lots.length > 1 && (
        <div className="max-w-xs space-y-1">
          <Label>Car lot</Label>
          <Select value={lotId} onValueChange={setLotId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{lots.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{lots.find((y) => y.id === lotId)?.name ?? "Car lot"}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !lotId ? (
            <p className="text-muted-foreground">There is no car-lot yard yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Free days</TableHead>
                  <TableHead>Logins</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((m) => {
                  const mine = logins.filter((l) => l.manufacturer_id === m.id);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono">{m.code}</TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>{m.contact_email || "—"}</TableCell>
                      <TableCell>{m.default_free_days}</TableCell>
                      <TableCell>{mine.length ? mine.map((l) => l.username || l.full_name).join(", ") : "—"}</TableCell>
                      <TableCell>
                        {m.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => openForm(m)}>Edit</Button>
                        <Button size="sm" variant="outline" disabled={!m.active} onClick={() => { setLoginFor(m); setLoginForm(EMPTY_LOGIN); }}>
                          <UserPlus className="h-3.5 w-3.5 mr-1" /> Add login
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setActive(m, !m.active)}>
                          {m.active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">No manufacturers yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing === "new" ? "Add manufacturer" : "Edit manufacturer"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Code</Label>
              <Input
                value={form.code}
                disabled={editing !== "new"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. TOY"
              />
              <p className="text-xs text-muted-foreground">2 to 10 letters or numbers. It cannot be changed later.</p>
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Toyota" />
            </div>
            <div className="space-y-1">
              <Label>Contact email (optional)</Label>
              <Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Free days</Label>
              <Input inputMode="numeric" value={form.default_free_days} onChange={(e) => setForm({ ...form, default_free_days: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!loginFor} onOpenChange={(open) => { if (!open) setLoginFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add a login for {loginFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input value={loginForm.fullName} onChange={(e) => setLoginForm({ ...loginForm, fullName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Username</Label>
              <Input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value.toLowerCase() })} />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input type="password" autoComplete="new-password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <p className="text-xs text-muted-foreground">
              This login sees only {loginFor?.name}&apos;s cars, read-only. The portal itself is not open yet, so
              until it is the person will see a holding page after signing in.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoginFor(null)}>Cancel</Button>
            <Button onClick={addLogin} disabled={busy}>{busy ? "Creating…" : "Create login"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Manufacturers;
