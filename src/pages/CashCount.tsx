import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Wallet, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatJod } from "@/lib/accounting";
import { previousShiftSlot, shiftSlotFor, type ShiftSlot } from "@/lib/shifts";

interface MyCount {
  id: string;
  shift_date: string;
  shift: "day" | "night";
  counted_cash: number;
  notes: string | null;
  created_at: string;
}

const slotKey = (s: ShiftSlot) => `${s.shiftDate}|${s.shift}`;
const slotLabel = (s: ShiftSlot) =>
  `${new Date(`${s.shiftDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })} · ${s.shift === "day" ? "Day (06:00–18:00)" : "Night (18:00–06:00)"}`;

/**
 * End-of-shift drawer count. The cashier enters what is physically in the
 * drawer; the system's expected figure is never shown here, so the count
 * can't be nudged to match. Admins see the comparison under Accounting.
 */
const CashCount = () => {
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();
  const yardId = currentYardId();

  // The current shift and the few before it — counts are usually entered at
  // the end of a shift or just after it.
  const slots = useMemo(() => {
    const list = [shiftSlotFor(new Date())];
    for (let i = 0; i < 3; i++) list.push(previousShiftSlot(list[list.length - 1]));
    return list;
  }, []);

  const [slot, setSlot] = useState(slotKey(slots[0]));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyCount[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("cash_counts")
      .select("id, shift_date, shift, counted_cash, notes, created_at")
      .eq("counted_by", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setMine((data ?? []) as MyCount[]);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const counted = new Set(mine.map((c) => `${c.shift_date}|${c.shift}`));
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value >= 0;

  const submit = async () => {
    const [shiftDate, shift] = slot.split("|") as [string, "day" | "night"];
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_cash_count", {
        _shift_date: shiftDate, _shift: shift, _counted: value, _notes: notes.trim() || null,
      });
      if (error) throw error;
      toast({ title: "Count recorded", description: `${formatJod(value)} for ${slotLabel({ shiftDate, shift })}.` });
      setAmount("");
      setNotes("");
      load();
    } catch (e) {
      const message = typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Not saved.";
      toast({ title: "Could not record the count", description: message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300 max-w-3xl">
      <PageHeader icon={Wallet} title="Cash Count" subtitle="Count the cash drawer at the end of your shift" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record the drawer</CardTitle>
          <CardDescription>
            Count every note and coin in the drawer and enter the total. Enter what is actually there — the
            system compares it with the recorded payments afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!yardId && <p className="text-sm text-destructive">Your account has no yard, so a count can't be recorded.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Shift</Label>
              <Select value={slot} onValueChange={setSlot}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={slotKey(s)} value={slotKey(s)} disabled={counted.has(slotKey(s))}>
                      {slotLabel(s)}{counted.has(slotKey(s)) ? " — counted" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-amount">Cash in drawer (JOD)</Label>
              <Input
                id="cash-amount"
                inputMode="decimal"
                type="number"
                min={0}
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.000"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-notes">Notes (optional)</Label>
            <Textarea id="cash-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 5 JOD float left in drawer" />
          </div>
          <Button onClick={submit} disabled={!valid || busy || !yardId || counted.has(slot)}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> {busy ? "Saving…" : "Record count"}
          </Button>
          <p className="text-xs text-muted-foreground">One count per shift. If you made a mistake, tell an admin.</p>
        </CardContent>
      </Card>

      {mine.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Your recent counts</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">{slotLabel({ shiftDate: c.shift_date, shift: c.shift })}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJod(c.counted_cash)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.notes || ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CashCount;
