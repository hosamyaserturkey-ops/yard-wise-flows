import { useCallback, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Package, Users, CheckCircle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { bookingSchema } from "@/lib/validation";
import type { Booking, CreateBookingData } from "@/types/booking";
import bgBookings from "@/assets/bg-bookings.jpg";

export default function Bookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateBookingData>({
    booking_number: "",
    customer_name: "",
    total_containers: 1,
  });
  const { user, currentYardId } = useAuth();
  const { toast } = useToast();

  const fetchBookings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
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
        description: "Failed to fetch bookings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-muted-foreground">Loading bookings...</div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgBookings})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="container mx-auto p-6 space-y-6 relative z-10">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="text-muted-foreground">
            Manage container bookings and track gate-out progress
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Booking
        </Button>
      </div>

      {showCreateForm && (
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
                Create your first booking to start managing container gate-outs
              </p>
              <Button onClick={() => setShowCreateForm(true)}>
                Create First Booking
              </Button>
            </CardContent>
          </Card>
        ) : (
          bookings.map((booking) => (
            <Card 
              key={booking.id} 
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/bookings/${booking.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold">{booking.booking_number}</h3>
                    <p className="text-muted-foreground flex items-center gap-2 mt-1">
                      <Users className="h-4 w-4" />
                      {booking.customer_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusColor(booking.status)}>
                      {booking.status}
                    </Badge>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      Total: {booking.total_containers} containers
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      Gated Out: {booking.gated_out_containers} containers
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Created: {booking.created_at.toLocaleDateString()}
                  </div>
                </div>
                
                {booking.total_containers > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{Math.round((booking.gated_out_containers / booking.total_containers) * 100)}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{
                          width: `${(booking.gated_out_containers / booking.total_containers) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end mt-4">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/bookings/${booking.id}`);
                    }}
                  >
                    View Details
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </div>
    </div>
  );
}