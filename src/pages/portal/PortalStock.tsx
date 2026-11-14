import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/i18n";
import { daysInLot, daysOverFree, type VisitStatus } from "@/lib/carLot";
import { formatPortalDate } from "@/lib/portalDates";
import { ChevronRight } from "lucide-react";

interface Row {
  id: string;
  status: VisitStatus;
  gate_in_time: string;
  gate_out_time: string | null;
  lot_zone: string | null;
  lot_slot: string | null;
  free_days: number;
  ticket_number: number;
  vehicles: { id: string; vin: string; model: string | null; model_year: number | null; color: string | null } | null;
}

const LIMIT = 500;

/** The manufacturer's cars: in the lot now, or released. Read-only. */
const PortalStock = () => {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const [tab, setTab] = useState<"open" | "out">("open");
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    // Row-level security returns only this manufacturer's cars; nothing here filters by name.
    let query = supabase
      .from("vehicle_visits")
      .select("id, status, gate_in_time, gate_out_time, lot_zone, lot_slot, free_days, ticket_number, vehicles(id, vin, model, model_year, color)")
      .order("gate_in_time", { ascending: false })
      .limit(LIMIT);
    query = tab === "open" ? query.in("status", ["in-lot", "on-hold"]) : query.eq("status", "out");
    const [visits, mfr] = await Promise.all([
      query,
      profile?.manufacturer_id
        ? supabase.from("manufacturers").select("name").eq("id", profile.manufacturer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (visits.error) setFailed(true);
    setRows((visits.data ?? []) as unknown as Row[]);
    setName(mfr.data?.name ?? "");
    setLoading(false);
  }, [tab, profile?.manufacturer_id]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((r) => [r.vehicles?.vin, r.vehicles?.model].some((v) => v?.toUpperCase().includes(q)));
  }, [rows, search]);

  const now = new Date();
  const model = (r: Row) => [r.vehicles?.model, r.vehicles?.model_year, r.vehicles?.color].filter(Boolean).join(" · ") || t("common.none");
  const spot = (r: Row) => [r.lot_zone, r.lot_slot].filter(Boolean).join(" / ") || t("common.none");
  const days = (r: Row) => daysInLot(r.gate_in_time, now, r.gate_out_time);
  const over = (r: Row) => (r.status === "out" ? 0 : daysOverFree(days(r), r.free_days));
  const empty = search ? t("stock.empty.search") : tab === "open" ? t("stock.empty.inLot") : t("stock.empty.released");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold sm:text-2xl">{t("stock.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("stock.subtitle", { name })}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(["open", "out"] as const).map((k) => (
            <Button key={k} type="button" size="sm" className="min-h-10" variant={tab === k ? "default" : "ghost"} onClick={() => setTab(k)}>
              {t(k === "open" ? "stock.tab.inLot" : "stock.tab.released")}
            </Button>
          ))}
        </div>
        <Input className="h-10 max-w-xs" placeholder={t("stock.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-sm text-muted-foreground">{t("stock.count", { n: shown.length })}</span>
      </div>

      {failed && <p role="alert" className="text-sm text-destructive">{t("common.error")}</p>}

      <Card>
        <CardContent className="p-3 sm:p-4">
          {loading ? (
            <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">{empty}</p>
          ) : (
            <>
              {/* Phones: one card per car. */}
              <ul className="space-y-3 md:hidden">
                {shown.map((r) => (
                  <li key={r.id}>
                    <Link to={`/portal/cars/${r.vehicles?.id}`} className="block rounded-lg border p-3 active:bg-muted">
                      <div className="flex items-start justify-between gap-2">
                        <span dir="ltr" className="font-mono text-sm break-all">{r.vehicles?.vin}</span>
                        <Badge variant={r.status === "on-hold" ? "outline" : "secondary"}>{t(`status.${r.status}`)}</Badge>
                      </div>
                      <p className="mt-1 text-sm">{model(r)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("stock.col.arrived")}: {formatPortalDate(r.gate_in_time, lang)} · {t("stock.col.days")}: {days(r)} · {t("stock.col.spot")}: {spot(r)}
                      </p>
                      {over(r) > 0 && <p className="mt-1 text-xs text-warning">{t("stock.overFree", { n: over(r) })}</p>}
                    </Link>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    {(["vin", "model", "arrived", "days", "spot", "status"] as const).map((c) => (
                      <TableHead key={c} className="text-start">{t(`stock.col.${c}`)}</TableHead>
                    ))}
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr" className="text-start font-mono text-xs">
                        <Link className="underline-offset-2 hover:underline" to={`/portal/cars/${r.vehicles?.id}`}>{r.vehicles?.vin}</Link>
                      </TableCell>
                      <TableCell className="text-start">{model(r)}</TableCell>
                      <TableCell className="text-start">{formatPortalDate(r.gate_in_time, lang)}</TableCell>
                      <TableCell className="text-start">
                        {days(r)}
                        {over(r) > 0 && <span className="ms-1 text-xs text-warning">({t("stock.overFree", { n: over(r) })})</span>}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start whitespace-nowrap">{spot(r)}</TableCell>
                      <TableCell className="text-start">
                        <Badge variant={r.status === "on-hold" ? "outline" : "secondary"}>{t(`status.${r.status}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Link aria-label={t("car.title")} to={`/portal/cars/${r.vehicles?.id}`}>
                          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length >= LIMIT && <p className="mt-3 text-xs text-muted-foreground">{t("stock.latest", { n: LIMIT })}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PortalStock;
