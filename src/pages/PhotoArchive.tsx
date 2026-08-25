import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveSignedUrl } from "@/lib/storage";
import { uploadPhotoFiles } from "@/lib/photoUpload";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Camera, Search, Plus, Ban } from "lucide-react";
import { CancelInspectionDialog } from "@/components/CancelInspectionDialog";
import { cancelInspection } from "@/lib/inspections";
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
  cancel_reason: string | null;
  yard_id: string;
}

interface EnrichedCheck extends Check {
  signedPhotos: string[];
  inspectorName?: string;
}

interface Group {
  container_number: string;
  checks: EnrichedCheck[];
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-success/10 text-success border-success/30",
  B: "bg-maritime/10 text-maritime border-maritime/30",
  C: "bg-warning/10 text-warning border-warning/30",
  D: "bg-destructive/10 text-destructive border-destructive/30",
};

const PhotoArchive = () => {
  const { user, currentYardId, isInspector, isAdmin, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  // Camera vs library: `capture` on an input opens the camera directly on
  // mobile with no route to the photo library, so each check gets both a
  // capture input and a plain one.
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const galleryInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canAddPhotos = isInspector() || isAdmin() || isSuperAdmin();
  // Voiding a check is admin-only: it decides whether a container may gate in.
  const canCancelChecks = isAdmin() || isSuperAdmin();
  const [pendingCancel, setPendingCancel] = useState<EnrichedCheck | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const yardId = currentYardId();
      let query = supabase
        .from("inspector_checks")
        .select("id, container_number, grade, status, notes, photo_urls, created_at, inspector_id, cancel_reason, yard_id")
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
  }, [currentYardId]);

  useEffect(() => {
    const q = search.trim().toUpperCase();
    if (q.length < 3) {
      setGroups([]);
      return;
    }
    const t = setTimeout(() => { void runSearch(q); }, 300);
    return () => clearTimeout(t);
  }, [search, runSearch]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (v) setParams({ q: v });
    else setParams({});
  };

  const handleAddPhotos = async (check: EnrichedCheck, files: File[]) => {
    if (!files.length) return;
    setUploadingIds((prev) => new Set(prev).add(check.id));
    try {
      const newKeys = await uploadPhotoFiles(files);
      const updatedPhotoUrls = [...(check.photo_urls ?? []), ...newKeys];
      const { error } = await supabase
        .from("inspector_checks")
        .update({ photo_urls: updatedPhotoUrls })
        .eq("id", check.id);
      if (error) throw error;

      const newSigned = (
        await Promise.all(newKeys.map((k) => resolveSignedUrl("inspection-photos", k)))
      ).filter((u): u is string => !!u);

      setGroups((prev) =>
        prev.map((g) =>
          g.container_number !== check.container_number
            ? g
            : {
                ...g,
                checks: g.checks.map((c) =>
                  c.id !== check.id
                    ? c
                    : { ...c, photo_urls: updatedPhotoUrls, signedPhotos: [...c.signedPhotos, ...newSigned] },
                ),
              },
        ),
      );
      toast({ title: "Photos added", description: `${newKeys.length} photo${newKeys.length !== 1 ? "s" : ""} added to ${check.container_number}.` });
    } catch (err) {
      console.error(err);
      toast({ title: "Upload failed", description: "Could not add photos. Please try again.", variant: "destructive" });
    } finally {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(check.id);
        return next;
      });
    }
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
            {g.checks.map((c) => {
              const uploading = uploadingIds.has(c.id);
              return (
                <div key={c.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge className={`border ${GRADE_COLOR[c.grade] ?? ""}`}>{c.grade}</Badge>
                    <Badge
                      variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "outline"}
                      className={c.status === "cancelled" ? "text-muted-foreground line-through" : undefined}
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
                  {c.status === "cancelled" && c.cancel_reason && (
                    <p className="text-xs text-muted-foreground italic">
                      Cancelled — {c.cancel_reason}
                    </p>
                  )}
                  {canCancelChecks && c.status === "approved" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive px-2"
                      onClick={() => setPendingCancel(c)}
                    >
                      <Ban className="h-4 w-4 mr-1.5" />
                      Cancel inspection
                    </Button>
                  )}
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
                  {canAddPhotos && (
                    <>
                      <input
                        ref={(el) => { fileInputRefs.current[c.id] = el; }}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          e.target.value = "";
                          void handleAddPhotos(c, files);
                        }}
                      />
                      <input
                        ref={(el) => { galleryInputRefs.current[c.id] = el; }}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          e.target.value = "";
                          void handleAddPhotos(c, files);
                        }}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={uploading}
                          onClick={() => fileInputRefs.current[c.id]?.click()}
                        >
                          <Camera className="h-3.5 w-3.5 mr-1" />
                          {uploading ? "Uploading…" : "Take Photos"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={uploading}
                          onClick={() => galleryInputRefs.current[c.id]?.click()}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          {uploading ? "Uploading…" : "Add From Gallery"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <CancelInspectionDialog
        containerNumber={pendingCancel?.container_number ?? null}
        open={pendingCancel !== null}
        onOpenChange={(o) => !o && setPendingCancel(null)}
        onConfirm={async (reason) => {
          if (!pendingCancel || !user) return;
          const { ok, error } = await cancelInspection({
            checkId: pendingCancel.id,
            reason,
            userId: user.id,
            // currentYardId() is null for a super admin viewing all yards, so
            // the check's own yard is the reliable source here.
            yardId: pendingCancel.yard_id,
            containerNumber: pendingCancel.container_number,
          });
          if (!ok) {
            toast({ title: "Could not cancel", description: error, variant: "destructive" });
            return;
          }
          toast({
            title: "Inspection cancelled",
            description: `${pendingCancel.container_number} no longer clears gate-in.`,
          });
          await runSearch(search.trim());
        }}
      />
    </div>
  );
};

export default PhotoArchive;
