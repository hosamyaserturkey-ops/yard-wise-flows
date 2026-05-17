import { useCallback, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Package, Users, CheckCircle, Clock, Truck, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Booking } from "@/types/booking";
import type { Container } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import bgBookingDetail from "@/assets/bg-booking-detail.jpg";

export default function BookingDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [assignedContainers, setAssignedContainers] = useState<Container[]>([]);
  const [availableContainers, setAvailableContainers] = useState<Container[]>([]);
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

      // Fetch assigned containers (reserved or gated out)
      const { data: assignedData, error: assignedError } = await supabase
        .from("containers")
        .select("*")
        .eq("booking_id", bookingId)
        .in("status", ["reserved", "out"])
        .order("created_at", { ascending: false });

      if (assignedError) throw assignedError;

      setAssignedContainers(assignedData.map(container => ({
        id: container.id,
        containerNumber: container.container_number,
        containerType: container.container_type,
        shippingLine: container.shipping_line as ShippingLine,
        driverName: container.driver_name,
        truckNumber: container.truck_number,
        gateInTime: new Date(container.gate_in_time),
        gateOutTime: container.gate_out_time ? new Date(container.gate_out_time) : undefined,
        status: container.status as 'in-yard' | 'out' | 'reserved',
        bookingNumber: container.booking_number,
        bookingId: container.booking_id,
        fees: container.fees,
      })));

      // Fetch available containers (in-yard with no booking)
      const { data: availableData, error: availableError } = await supabase
        .from("containers")
        .select("*")
        .eq("status", "in-yard")
        .is("booking_id", null)
        .order("gate_in_time", { ascending: false });

      if (availableError) throw availableError;

      setAvailableContainers(availableData.map(container => ({
        id: container.id,
        containerNumber: container.container_number,
        containerType: container.container_type,
        shippingLine: container.shipping_line as ShippingLine,
        driverName: container.driver_name,
        truckNumber: container.truck_number,
        gateInTime: new Date(container.gate_in_time),
        status: container.status as 'in-yard' | 'out' | 'reserved',
      })));
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

    try {
      const { error } = await supabase
        .from("containers")
        .update({
          status: "reserved",
          booking_id: booking.id,
          booking_number: booking.booking_number,
        })
        .eq("id", containerId);

      if (error) throw error;

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
      const { error } = await supabase
        .from("containers")
        .update({
          status: "in-yard",
          booking_id: null,
          booking_number: null,
        })
        .eq("id", containerId);

      if (error) throw error;

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
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'completed':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'cancelled':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  const getContainerStatusColor = (status: string) => {
    switch (status) {
      case 'reserved':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'out':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
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
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgBookingDetail})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="container mx-auto p-6 space-y-6 relative z-10">
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
                      {container.status === "reserved" && (
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

      {/* Available Containers */}
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
      </div>
    </div>
  );
}
