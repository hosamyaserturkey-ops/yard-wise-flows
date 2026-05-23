import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Container, Ship, Clock, Users, Calendar, Search } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ReserveContainerDialog from "@/components/ReserveContainerDialog";
import ContainerDetailDialog from "@/components/ContainerDetailDialog";
import bgDashboard from "@/assets/bg-dashboard.jpg";

const Dashboard = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // dialogs
  const [reserveDialogOpen, setReserveDialogOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContainer, setDetailContainer] = useState<ContainerType | null>(null);

  // filters
  const [statusFilter, setStatusFilter] = useState<"all" | "in-yard" | "reserved" | "out">("all");
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Redirect inspectors to their page
  useEffect(() => {
    if (profile?.role === "inspector") {
      navigate("/inspector", { replace: true });
    }
  }, [profile, navigate]);

  const fetchContainers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("containers")
        .select("*")
        .order("gate_in_time", { ascending: false });

      if (error) throw error;

      const formatted: ContainerType[] = (data ?? []).map((c) => ({
        id: c.id,
        containerNumber: c.container_number,
        containerType: c.container_type,
        shippingLine: c.shipping_line as ShippingLine,
        driverName: c.driver_name,
        truckNumber: c.truck_number,
        gateInTime: new Date(c.gate_in_time),
        gateOutTime: c.gate_out_time ? new Date(c.gate_out_time) : undefined,
        status: c.status as "in-yard" | "out" | "reserved",
        bookingNumber: c.booking_number,
        bookingId: c.booking_id,
        fees: c.fees ? Number(c.fees) : undefined,
      }));

      setContainers(formatted);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Error fetching containers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("dashboard_containers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "containers" },
        () => fetchContainers(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchContainers]);

  // Counts
  const inYardCount = containers.filter((c) => c.status === "in-yard").length;
  const reservedCount = containers.filter((c) => c.status === "reserved").length;
  const outCount = containers.filter((c) => c.status === "out").length;

  // Unique shipping lines present in data (for dynamic filter buttons)
  const shippingLines = useMemo(
    () => Array.from(new Set(containers.map((c) => c.shippingLine))).sort(),
    [containers],
  );

  // Counts per line for the currently visible status tab
  const lineCount = (line: string) =>
    containers.filter(
      (c) =>
        (statusFilter === "all" || c.status === statusFilter) &&
        c.shippingLine === line,
    ).length;

  // Filtered list
  const filteredContainers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return containers.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (lineFilter !== "all" && c.shippingLine !== lineFilter) return false;
      if (q) {
        return (
          c.containerNumber.toLowerCase().includes(q) ||
          c.driverName?.toLowerCase().includes(q) ||
          c.truckNumber?.toLowerCase().includes(q) ||
          c.shippingLine?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [containers, statusFilter, lineFilter, search]);

  const openDetail = (c: ContainerType) => {
    setDetailContainer(c);
    setDetailOpen(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 text-white">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgDashboard})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="space-y-6 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-industrial">Dashboard</h1>
          <div className="text-sm text-white/70">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Containers In Yard"
            value={inYardCount}
            color="maritime"
            icon={<Container className="h-4 w-4 text-maritime" />}
          />
          <StatCard
            label="Reserved"
            value={reservedCount}
            color="warning"
            icon={<Calendar className="h-4 w-4 text-warning" />}
          />
          <StatCard
            label="Containers Out"
            value={outCount}
            color="success"
            icon={<Ship className="h-4 w-4 text-success" />}
          />
          <StatCard
            label="Total Containers"
            value={containers.length}
            color="container"
            icon={<Users className="h-4 w-4 text-container" />}
          />
        </div>

        {/* Container Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-maritime" />
              <span>Container Activity</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              defaultValue="all"
              onValueChange={(v) =>
                setStatusFilter(v as "all" | "in-yard" | "reserved" | "out")
              }
            >
              {/* Status tabs + search row */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
                <TabsList>
                  <TabsTrigger value="all">All ({containers.length})</TabsTrigger>
                  <TabsTrigger value="in-yard">In Yard ({inYardCount})</TabsTrigger>
                  <TabsTrigger value="reserved">Reserved ({reservedCount})</TabsTrigger>
                  <TabsTrigger value="out">Out ({outCount})</TabsTrigger>
                </TabsList>

                {/* Search */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8 h-9 text-sm"
                    placeholder="Search container, driver…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Shipping line filter */}
              {shippingLines.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-4">
                  <Button
                    size="sm"
                    variant={lineFilter === "all" ? "default" : "outline"}
                    onClick={() => setLineFilter("all")}
                  >
                    All Lines
                  </Button>
                  {shippingLines.map((line) => (
                    <Button
                      key={line}
                      size="sm"
                      variant={lineFilter === line ? "default" : "outline"}
                      onClick={() => setLineFilter(line)}
                    >
                      {line} ({lineCount(line)})
                    </Button>
                  ))}
                </div>
              )}

              {/* Single shared content — all tabs use same filteredContainers */}
              {(["all", "in-yard", "reserved", "out"] as const).map((tab) => (
                <TabsContent key={tab} value={tab} className="space-y-1 mt-0">
                  {filteredContainers.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      No containers match the current filters.
                    </div>
                  ) : (
                    <div className="divide-y rounded-lg border overflow-hidden">
                      {filteredContainers.map((c) => (
                        <ContainerRow
                          key={c.id}
                          container={c}
                          onClick={() => openDetail(c)}
                          onReserve={(e) => {
                            e.stopPropagation();
                            setSelectedContainer(c);
                            setReserveDialogOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <ReserveContainerDialog
        open={reserveDialogOpen}
        onOpenChange={setReserveDialogOpen}
        container={selectedContainer}
        onReserved={() => {
          fetchContainers();
          setSelectedContainer(null);
        }}
      />

      <ContainerDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        container={detailContainer}
      />
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "outline" | "secondary" }> = {
  "in-yard": { label: "IN", variant: "default" },
  reserved: { label: "RESERVED", variant: "outline" },
  out: { label: "OUT", variant: "secondary" },
};

const ContainerRow = ({
  container: c,
  onClick,
  onReserve,
}: {
  container: ContainerType;
  onClick: () => void;
  onReserve: (e: React.MouseEvent) => void;
}) => {
  const badge = STATUS_BADGE[c.status] ?? { label: c.status.toUpperCase(), variant: "secondary" as const };
  return (
    <div
      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors group"
      onClick={onClick}
    >
      <div className="flex items-center space-x-4 min-w-0">
        <Badge variant={badge.variant} className="shrink-0">
          {badge.label}
        </Badge>
        <div className="min-w-0">
          <div className="font-medium font-mono text-sm group-hover:text-maritime transition-colors">
            {c.containerNumber}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {c.driverName} • {c.truckNumber}
            {c.bookingNumber && ` • ${c.bookingNumber}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium">{c.shippingLine}</div>
          <div className="text-xs text-muted-foreground">
            {c.status === "out"
              ? c.gateOutTime?.toLocaleDateString()
              : c.gateInTime.toLocaleDateString()}
          </div>
          {c.fees != null && (
            <div className="text-xs font-medium text-success">{c.fees} JOD</div>
          )}
        </div>

        {(c.status === "in-yard" || c.status === "reserved") && (
          <Button size="sm" variant="outline" onClick={onReserve} className="shrink-0">
            {c.status === "reserved" ? "Unreserve" : "Reserve"}
          </Button>
        )}
      </div>
    </div>
  );
};

const StatCard = ({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}) => (
  <Card className={`border-l-4 border-l-${color}`}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{label}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className={`text-2xl font-bold text-${color}`}>{value}</div>
    </CardContent>
  </Card>
);

export default Dashboard;
