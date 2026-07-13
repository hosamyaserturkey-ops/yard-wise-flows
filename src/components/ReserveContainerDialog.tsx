import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLog";
import type { Booking } from "@/types/booking";
import type { Container } from "@/types/container";

interface ReserveContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: Container | null;
  onReserved: () => void;
}

export default function ReserveContainerDialog({
  open,
  onOpenChange,
  container,
  onReserved,
}: ReserveContainerDialogProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchActiveBookings();
    }
  }, [open]);

  const fetchActiveBookings = async () => {
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setBookings(data.map(booking => ({
        ...booking,
        status: booking.status as 'active' | 'completed' | 'cancelled',
        created_at: new Date(booking.created_at),
        updated_at: new Date(booking.updated_at),
      })));
    } catch (error) {
      console.error("Error fetching bookings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch active bookings",
        variant: "destructive",
      });
    }
  };

  const handleReserve = async () => {
    if (!container || !selectedBookingId || !user) return;

    const selectedBooking = bookings.find(b => b.id === selectedBookingId);
    if (!selectedBooking) return;

    setLoading(true);
    try {
      // Atomic guard: only reserve if the visit is still in-yard.
      const { data, error } = await supabase
        .from("container_visits")
        .update({
          status: "reserved",
          booking_id: selectedBookingId,
          booking_number: selectedBooking.booking_number,
        })
        .eq("id", container.id)
        .eq("status", "in-yard")
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) {
        toast({
          title: "Already reserved",
          description: "Someone else reserved this container first.",
          variant: "destructive",
        });
        onReserved();
        onOpenChange(false);
        return;
      }

      const yardId = currentYardId();
      if (user && yardId) {
        await logActivity({
          userId: user.id,
          yardId,
          action: "reserve",
          containerId: container.id,
          containerNumber: container.containerNumber,
          metadata: { booking_number: selectedBooking.booking_number },
        });
      }

      toast({
        title: "Success",
        description: "Container reserved successfully",
      });

      onReserved();
      onOpenChange(false);
      setSelectedBookingId("");
    } catch (error) {
      console.error("Error reserving container:", error);
      toast({
        title: "Error",
        description: "Failed to reserve container",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUnreserve = async () => {
    if (!container || !user) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("container_visits")
        .update({
          status: "in-yard",
          booking_id: null,
          booking_number: null,
        })
        .eq("id", container.id);

      if (error) throw error;

      const yardId = currentYardId();
      if (user && yardId) {
        await logActivity({
          userId: user.id,
          yardId,
          action: "unreserve",
          containerId: container.id,
          containerNumber: container.containerNumber,
        });
      }

      toast({
        title: "Success",
        description: "Container unreserved successfully",
      });

      onReserved();
      onOpenChange(false);
    } catch (error) {
      console.error("Error unreserving container:", error);
      toast({
        title: "Error",
        description: "Failed to unreserve container",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {container?.status === "reserved" ? "Unreserve Container" : "Reserve Container"}
          </DialogTitle>
          <DialogDescription>
            {container?.status === "reserved" 
              ? `Remove reservation for container ${container?.containerNumber}`
              : `Reserve container ${container?.containerNumber} for a booking`
            }
          </DialogDescription>
        </DialogHeader>

        {container?.status === "reserved" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This container is currently reserved. Click below to unreserve it.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleUnreserve} disabled={loading}>
                {loading ? "Unreserving..." : "Unreserve Container"}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="booking">Select Booking</Label>
              <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a booking..." />
                </SelectTrigger>
                <SelectContent>
                  {bookings.map((booking) => (
                    <SelectItem key={booking.id} value={booking.id}>
                      {booking.booking_number} - {booking.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleReserve} 
                disabled={loading || !selectedBookingId}
              >
                {loading ? "Reserving..." : "Reserve Container"}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}