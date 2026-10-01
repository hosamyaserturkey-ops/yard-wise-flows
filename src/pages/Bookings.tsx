import { useCallback, useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Package, ArrowRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYards } from "@/hooks/useYards";
import { useToast } from "@/hooks/use-toast";
import { bookingSchema } from "@/lib/validation";
import type { Booking, CreateBookingData } from "@/types/booking";
import { fetchShippingLines, type ShippingLineRow } from "@/lib/shippingLines";
import { PageHeader } from "@/components/PageHeader";
import { YardSelectionGuard } from "@/components/YardSelectionGuard";
import { formatDate } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePagination } from "@/hooks/usePagination";
import { TablePager } from "@/components/TablePager";

const STATUS_TABS = ["active", "completed", "cancelled", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function Bookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("active");
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [shippingLines, setShippingLines] = useState<ShippingLineRow[]>([]);
  const [formData, setFormData] = useState<CreateBookingData>({
    booking_number: "",
    customer_name: "",
    shipping_line: "",
    total_containers: 1,
  });
  const { user, profile, currentYardId, isAdmin, isSuperAdmin, isLineRep, selectedYardId } = useAuth();
  const { nameOf: yardName } = useYards();
  const { toast } = useToast();

  useEffect(() => {
    fetchShippingLines().then(setShippingLines).catch((e) => console.error(e));
  }, []);

  const fetchBookings = useCallback(async () => {
    try {
      const yardId = currentYardId();
      let query = supabase
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false });
      if (yardId) query = query.eq("yard_id", yardId);
      const { data, error } = await query;

      if (error) throw error;

      setBookings(data.map(booking => ({
        ...booking,
        status: booking.status as 'active' | 'completed' | 'cancelled',
        created_at: new Date(booking.created_at),
        updated_at: new Date(booking.updated_at),
      })));

      // Auto-complete bookings where all containers are gated out
      const toComplete = data.filter(
        (b) => b.status === 'active' && b.total_containers > 0 && b.gated_out_containers >= b.total_containers
      );
      if (toComplete.length > 0) {
        await supabase
          .from('bookings')
          .update({ status: 'completed' })
          .in('id', toComplete.map((b) => b.id));
      }
    } catch (error) {
      console.error("Error fetching bookings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch bookings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, currentYardId]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Validate with zod
    const result = bookingSchema.safeParse(formData);
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const yardId = currentYardId();
      if (!yardId) {
        toast({ title: "Error", description: "No yard assigned to your account", variant: "destructive" });
        setCreating(false);
        return;
      }
      const { error } = await supabase
        .from("bookings")
        .insert({
          ...formData,
          // The schema trims the number and the customer name; the trimmed
          // values are what gate-out matches on, so insert those, not the raw
          // field state.
          ...result.data,
          created_by: user.id,
          yard_id: yardId,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Booking created successfully",
      });

      setFormData({
        booking_number: "",
        customer_name: "",
        shipping_line: "",
        total_containers: 1,
      });
      setShowCreateForm(false);
      fetchBookings();
    } catch (error) {
      console.error("Error creating booking:", error);
      toast({
        title: "Error",
        description: "Failed to create booking",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const countFor = (t: StatusTab) => (t === "all" ? bookings.length : bookings.filter((b) => b.status === t).length);
  // A search looks through every booking, so a finished one is still found
  // from the Active tab.
  const visibleBookings = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return bookings.filter((b) =>
      q
        ? b.booking_number.toLowerCase().includes(q) || b.customer_name.toLowerCase().includes(q)
        : statusTab === "all" || b.status === statusTab,
    );
  }, [bookings, searchTerm, statusTab]);
  const pager = usePagination(visibleBookings, 50, JSON.stringify([searchTerm, statusTab]));

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', cancelTarget.id);
    if (error) {
      toast({ title: "Couldn't cancel the booking", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Booking ${cancelTarget.booking_number} cancelled` });
    }
    setCancelTarget(null);
    fetchBookings();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-maritime/10 text-maritime border-maritime/20';
      case 'completed':
        return 'bg-success/10 text-success border-success/20';
      case 'cancelled':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-muted-foreground">Loading bookings...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Package}
        title="Bookings"
        subtitle={isLineRep() ? `${profile?.shipping_line ?? "Your line"} bookings in your yard` : "Manage container bookings and track gate-out progress"}
        action={
          !isLineRep() && (
            <Button onClick={() => setShowCreateForm(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Booking
            </Button>
          )
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by booking number or customer…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {showCreateForm && isSuperAdmin() && !selectedYardId ? (
        <YardSelectionGuard description='You&rsquo;re viewing "All yards." Creating a booking needs one specific yard selected — pick one:' />
      ) : showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Booking</CardTitle>
            <CardDescription>
              Set up a new booking with container allocation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="booking_number">Booking Number</Label>
                  <Input
                    id="booking_number"
                    value={formData.booking_number}
                    onChange={(e) =>
                      setFormData({ ...formData, booking_number: e.target.value })
                    }
                    placeholder="Enter booking number"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer_name">Customer Name</Label>
                  <Input
                    id="customer_name"
                    value={formData.customer_name}
                    onChange={(e) =>
                      setFormData({ ...formData, customer_name: e.target.value })
                    }
                    placeholder="Enter customer name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_line">Shipping Line</Label>
                  <Select
                    value={formData.shipping_line}
                    onValueChange={(value) => setFormData({ ...formData, shipping_line: value })}
                  >
                    <SelectTrigger id="shipping_line">
                      <SelectValue placeholder="Select the line…" />
                    </SelectTrigger>
                    <SelectContent>
                      {shippingLines.map((line) => (
                        <SelectItem key={line.code} value={line.code}>
                          {line.name && line.name !== line.code
                            ? `${line.code} — ${line.name}`
                            : line.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Only containers on this line can be reserved or gated out against the booking.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total_containers">Total Containers</Label>
                  <Input
                    id="total_containers"
                    type="number"
                    min="1"
                    value={formData.total_containers}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        total_containers: parseInt(e.target.value) || 1,
                      })
                    }
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create Booking"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {bookings.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No bookings found</h3>
              <p className="text-muted-foreground text-center mb-4">
                {isLineRep()
                  ? profile?.shipping_line
                    ? `No ${profile.shipping_line} bookings have been created for this yard yet.`
                    : "No bookings have been created for this yard yet."
                  : "Create your first booking to start managing container gate-outs"}
              </p>
              {!isLineRep() && (
                <Button onClick={() => setShowCreateForm(true)}>
                  Create First Booking
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
                <TabsList>
                  {STATUS_TABS.map((t) => (
                    <TabsTrigger key={t} value={t} className="capitalize">
                      {t} <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{countFor(t)}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {searchTerm.trim() && statusTab !== "all" && (
                <p className="text-xs text-muted-foreground">Searching all bookings, whatever their status.</p>
              )}
              {visibleBookings.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No {statusTab === "all" || searchTerm.trim() ? "" : `${statusTab} `}bookings match.
                </p>
              ) : (
                <>
                  <Table containerClassName="rounded-md border">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Booking</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Line</TableHead>
                        {isSuperAdmin() && <TableHead>Yard</TableHead>}
                        <TableHead className="w-56">Gated out</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pager.pageItems.map((booking) => {
                        const pct = booking.total_containers > 0
                          ? Math.round((booking.gated_out_containers / booking.total_containers) * 100)
                          : 0;
                        return (
                          <TableRow
                            key={booking.id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/bookings/${booking.id}`)}
                          >
                            <TableCell className="font-semibold whitespace-nowrap">{booking.booking_number}</TableCell>
                            <TableCell className="max-w-[16rem] truncate">{booking.customer_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{booking.shipping_line || "No line"}</Badge>
                            </TableCell>
                            {isSuperAdmin() && <TableCell className="text-xs">{yardName(booking.yard_id)}</TableCell>}
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-20 shrink-0 rounded-full bg-muted" aria-hidden>
                                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-sm tabular-nums whitespace-nowrap">
                                  {booking.gated_out_containers} of {booking.total_containers}{" "}
                                  {booking.total_containers === 1 ? "container" : "containers"}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(booking.created_at)}</TableCell>
                            <TableCell>
                              <Badge className={getStatusColor(booking.status)}>{booking.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {booking.status === 'active' && isAdmin() && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCancelTarget(booking);
                                  }}
                                >
                                  Cancel
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/bookings/${booking.id}`);
                                }}
                              >
                                View <ArrowRight className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <TablePager {...pager} noun="bookings" />
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel booking {cancelTarget?.booking_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.customer_name} · {cancelTarget?.gated_out_containers} of {cancelTarget?.total_containers} gated out.
              A cancelled booking can no longer be attached at gate-out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmCancel()}
            >
              Cancel booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}