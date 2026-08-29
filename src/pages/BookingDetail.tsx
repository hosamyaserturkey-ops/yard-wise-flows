import { useCallback, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Package, Users, CheckCircle, Clock, Truck, DollarSign, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Booking } from "@/types/booking";
import type { Container } from "@/types/container";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";

interface HistoryEvent {
  id: string;
  action: string;
  containerNumber: string | null;
  occurredAt: Date;
  feesJod: number | null;
}


export default function BookingDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { isLineRep } = useAuth();
  const { toast } = useToast();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [assignedContainers, setAssignedContainers] = useState<Container[]>([]);
  const [availableContainers, setAvailableContainers] = useState<Container[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookingDetails = useCallback(async () => {
    try {
      // Fetch booking details
      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .single();

      if (bookingError) throw bookingError;

      setBooking({
        ...bookingData,
        status: bookingData.status as 'active' | 'completed' | 'cancelled',
        created_at: new Date(bookingData.created_at),
        updated_at: new Date(bookingData.updated_at),
      });

      // Fetch assigned visits (reserved or gated out)
      const { data: assignedData, error: assignedError } = await supabase
        .from("container_visits")
        .select(VISIT_WITH_CONTAINER)
        .eq("booking_id", bookingId)
        .in("status", ["reserved", "out"])
        .order("created_at", { ascending: false });

      if (assignedError) throw assignedError;

      setAssignedContainers(
        (assignedData ?? []).map((row) => mapVisit(row as unknown as VisitJoinRow))
      );

      // Fetch available visits (in-yard with no booking)
      const { data: availableData, error: availableError } = await supabase
        .from("container_visits")
        .select(VISIT_WITH_CONTAINER)
        .eq("status", "in-yard")
        .is("booking_id", null)
        .is("gate_out_time", null)
        .order("gate_in_time", { ascending: false });

      if (availableError) throw availableError;

      setAvailableContainers(
        (availableData ?? []).map((row) => mapVisit(row as unknown as VisitJoinRow))
      );

      // History: gate/reserve events tied to this booking, kept even after the
      // underlying container_visits row is gone (e.g. test data cleanup).
      const { data: historyData, error: historyError } = await supabase
        .from("activity_log")
        .select("id, action, container_number, occurred_at, metadata")
        .eq("metadata->>booking_number", bookingData.booking_number)
        .order("occurred_at", { ascending: false });

      if (historyError) throw historyError;

      setHistory(
        (historyData ?? []).map((row) => ({
          id: row.id,
          action: row.action,
          containerNumber: row.container_number,
          occurredAt: new Date(row.occurred_at),
          feesJod:
            typeof (row.metadata as Record<string, unknown> | null)?.fees_jod === "number"
              ? ((row.metadata as Record<string, unknown>).fees_jod as number)
              : null,
        }))
      );
    } catch (error) {
      console.error("Error fetching booking details:", error);
      toast({
        title: "Error",
        description: "Failed to fetch booking details",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [bookingId, toast]);

  useEffect(() => {
    if (bookingId) {
      fetchBookingDetails();
    }
  }, [bookingId, fetchBookingDetails]);


  const handleAssignContainer = async (containerId: string) => {
    if (!booking) return;

    if (assignedContainers.length >= booking.total_containers) {
      toast({
        title: "Booking full",
        description: `This booking already has ${booking.total_containers} container(s) assigned.`,
        variant: "destructive",
      });
      return;
    }

    try {
      // Atomic guard: only assign if the visit is still free.
      const { data, error } = await supabase
        .from("container_visits")
        .update({
          status: "reserved",
          booking_id: booking.id,
          booking_number: booking.booking_number,
        })
        .eq("id", containerId)
        .eq("status", "in-yard")
        .is("booking_id", null)
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) {
        // Zero rows means one of three different things, and Postgres reports
        // none of them as an error: the guard clauses did not match (someone
        // took the container), RLS refused the write (this user may not assign
        // in this yard), or the visit is gone. Re-read the row to say which,
        // instead of always blaming a race — a permission problem reported as
        // "someone else assigned it" sends people looking for the wrong thing.
        const { data: current } = await supabase
          .from("container_visits")
          .select("status, booking_id, booking_number")
          .eq("id", containerId)
          .maybeSingle();

        if (!current) {
          toast({
            title: "Container unavailable",
            description: "This container is no longer in the yard.",
            variant: "destructive",
          });
        } else if (current.booking_id) {
          toast({
            title: "Container unavailable",
            description: current.booking_number
              ? `This container was just assigned to booking ${current.booking_number}.`
              : "This container was just assigned by someone else.",
            variant: "destructive",
          });
        } else if (current.status !== "in-yard") {
          toast({
            title: "Container unavailable",
            description: `This container is ${current.status}, so it cannot be assigned.`,
            variant: "destructive",
          });
        } else {
          // Still in-yard and unassigned, yet the update changed nothing: the
          // only remaining explanation is that RLS blocked it.
          toast({
            title: "Not allowed",
            description:
              "You do not have permission to assign this container. Ask a yard admin.",
            variant: "destructive",
          });
        }

        fetchBookingDetails();
        return;
      }

      toast({
        title: "Success",
        description: "Container assigned to booking",
      });

      fetchBookingDetails();
    } catch (error) {
      console.error("Error assigning container:", error);
      toast({
        title: "Error",
        description: "Failed to assign container",
        variant: "destructive",
      });
    }
  };

  const handleUnassignContainer = async (containerId: string) => {
    try {
      // select() so a write RLS refuses is visible: without it the update
      // reports success while changing nothing.
      const { data, error } = await supabase
        .from("container_visits")
        .update({
          status: "in-yard",
          booking_id: null,
          booking_number: null,
        })
        .eq("id", containerId)
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) {
        toast({
          title: "Not allowed",
          description:
            "You do not have permission to unassign this container. Ask a yard admin.",
          variant: "destructive",
        });
        fetchBookingDetails();
        return;
      }

      toast({
        title: "Success",
        description: "Container unassigned from booking",
      });

      fetchBookingDetails();
    } catch (error) {
      console.error("Error unassigning container:", error);
      toast({
        title: "Error",
        description: "Failed to unassign container",
        variant: "destructive",
      });
    }
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

  const getContainerStatusColor = (status: string) => {
    switch (status) {
      case 'reserved':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'out':
        return 'bg-success/10 text-success border-success/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-muted-foreground">Loading booking details...</div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Booking not found</h2>
          <Button onClick={() => navigate("/bookings")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Bookings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/bookings")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{booking.booking_number}</h1>
          <p className="text-muted-foreground">Booking details and container assignment</p>
        </div>
      </div>

      {/* Booking Summary */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Booking Information</CardTitle>
              <CardDescription>Overview of this booking</CardDescription>
            </div>
            <Badge className={getStatusColor(booking.status)}>{booking.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-semibold">{booking.customer_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Total Containers</p>
                <p className="font-semibold">{booking.total_containers}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Gated Out</p>
                <p className="font-semibold">{booking.gated_out_containers}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-semibold">{booking.created_at.toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {booking.total_containers > 0 && (
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">Progress</span>
                <span className="text-muted-foreground">
                  {assignedContainers.length} assigned / {booking.gated_out_containers} gated out / {booking.total_containers} total
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="bg-primary h-3 rounded-full transition-all"
                  style={{
                    width: `${(booking.gated_out_containers / booking.total_containers) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assigned Containers */}
      <Card>
        <CardHeader>
          <CardTitle>Assigned Containers ({assignedContainers.length})</CardTitle>
          <CardDescription>Containers reserved or gated out for this booking</CardDescription>
        </CardHeader>
        <CardContent>
          {assignedContainers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No containers assigned yet. Assign containers from the available list below.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Gate In</TableHead>
                  <TableHead>Gate Out</TableHead>
                  <TableHead>Fees</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedContainers.map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-mono">{container.containerNumber}</TableCell>
                    <TableCell>{container.containerType}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{container.shippingLine}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getContainerStatusColor(container.status)}>
                        {container.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{container.driverName}</TableCell>
                    <TableCell>{container.truckNumber}</TableCell>
                    <TableCell className="text-sm">
                      {container.gateInTime.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {container.gateOutTime ? container.gateOutTime.toLocaleString() : "-"}
                    </TableCell>
                    <TableCell>
                      {container.fees ? (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {container.fees}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {container.status === "reserved" && !isLineRep() && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnassignContainer(container.id)}
                        >
                          Unassign
                        </Button>
                      )}
                      {container.status === "out" && (
                        <span className="text-sm text-muted-foreground">Gated Out</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* History — audit trail from activity_log, survives deleted containers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            History
          </CardTitle>
          <CardDescription>Gate and reservation events recorded for this booking</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No activity recorded for this booking yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Container #</TableHead>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Fees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {event.action.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{event.containerNumber ?? "-"}</TableCell>
                    <TableCell className="text-sm">{event.occurredAt.toLocaleString()}</TableCell>
                    <TableCell>
                      {event.feesJod != null ? (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {event.feesJod}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Available Containers — assignment UI, not shown to read-only line reps */}
      {!isLineRep() && (
      <Card>
        <CardHeader>
          <CardTitle>Available Containers ({availableContainers.length})</CardTitle>
          <CardDescription>In-yard containers ready to be assigned</CardDescription>
        </CardHeader>
        <CardContent>
          {availableContainers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No available containers in the yard
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Shipping Line</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Gate In</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availableContainers.map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-mono">{container.containerNumber}</TableCell>
                    <TableCell>{container.containerType}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{container.shippingLine}</Badge>
                    </TableCell>
                    <TableCell className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      {container.driverName}
                    </TableCell>
                    <TableCell>{container.truckNumber}</TableCell>
                    <TableCell className="text-sm">
                      {container.gateInTime.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => handleAssignContainer(container.id)}
                      >
                        Assign
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
