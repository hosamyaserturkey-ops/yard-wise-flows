import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveSignedUrl } from "@/lib/storage";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Camera, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";

interface Check {
  id: string;
  container_number: string;
  grade: string;
  status: string;
  notes: string | null;
  photo_urls: string[] | null;
  created_at: string;
  inspector_id: string | null;
}

interface Group {
  container_number: string;
  checks: Array<Check & { signedPhotos: string[]; inspectorName?: string }>;
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-red-100 text-red-800 border-red-300",
};

const PhotoArchive = () => {
  const { currentYardId } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = search.trim().toUpperCase();
    if (q.length < 3) {
      setGroups([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const yardId = currentYardId();
        let query = supabase
          .from("inspector_checks")
          .select("id, container_number, grade, status, notes, photo_urls, created_at, inspector_id")
          .ilike("container_number", `%${q}%`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (yardId) query = query.eq("yard_id", yardId);
        const { data } = await query;
        const checks = (data ?? []) as Check[];

        // group by container
        const byNum = new Map<string, Check[]>();
        checks.forEach((c) => {
          if (!byNum.has(c.container_number)) byNum.set(c.container_number, []);
          byNum.get(c.container_number)!.push(c);
        });

        // load inspector names
        const inspectorIds = Array.from(new Set(checks.map((c) => c.inspector_id).filter(Boolean))) as string[];
        const inspectorMap: Record<string, string> = {};
        if (inspectorIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name, username")
            .in("user_id", inspectorIds);
          (profs ?? []).forEach((p) => {
            inspectorMap[p.user_id] = p.full_name || p.username || p.user_id.slice(0, 8);
          });
        }

        // resolve signed URLs
        const out: Group[] = [];
        for (const [num, list] of byNum.entries()) {
          const enriched = await Promise.all(
            list.map(async (c) => {
              const urls = Array.isArray(c.photo_urls) ? c.photo_urls : [];
              const signed = await Promise.all(urls.map((p) => resolveSignedUrl("inspection-photos", p)));
              return {
                ...c,
                signedPhotos: signed.filter((u): u is string => !!u),
                inspectorName: c.inspector_id ? inspectorMap[c.inspector_id] : undefined,
              };
            }),
          );
          out.push({ container_number: num, checks: enriched });
        }
        setGroups(out.sort((a, b) => a.container_number.localeCompare(b.container_number)));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, currentYardId]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (v) setParams({ q: v });
    else setParams({});
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Camera}
        title="Photo Evidence Archive"
        subtitle="Search inspector gate-in photos by container number"
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-10"
          placeholder="Enter container number (min 3 chars)…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Searching…</p>}

      {!loading && search.trim().length >= 3 && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No inspection records found.</p>
      )}

      {groups.map((g) => (
        <Card key={g.container_number}>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-lg">{g.container_number}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {g.checks.map((c) => (
              <div key={c.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className={`border ${GRADE_COLOR[c.grade] ?? ""}`}>{c.grade}</Badge>
                  <Badge
                    variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "outline"}
                  >
                    {c.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("en-GB")}
                  </span>
                  {c.inspectorName && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      Inspector: {c.inspectorName}
                    </span>
                  )}
                </div>
                {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
                {c.signedPhotos.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {c.signedPhotos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`${c.container_number} photo ${i + 1}`}
                          className="h-32 w-32 object-cover rounded border hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No photos attached to this inspection.</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PhotoArchive;
