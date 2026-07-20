import { useCallback, useState, useEffect } from "react";
import { printGateOutReceipt } from "@/lib/gateOutReceipt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Ship, Search } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateOutSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import { logActivity } from "@/lib/activityLog";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";

const GateOut = () => {
  const { user, profile, currentYardId } = useAuth();
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [bookingNumber, setBookingNumber] = useState("");
  const [fees, setFees] = useState("");
  const [driverName, setDriverName] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch containers in yard
  const fetchContainers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('container_visits')
        .select(VISIT_WITH_CONTAINER)
        .in('status', ['reserved', 'in-yard'])
        .is('gate_out_time', null)
        .order('gate_in_time', { ascending: false });

      if (error) throw error;

      const formattedContainers: ContainerType[] = (data ?? []).map((row) =>
        mapVisit(row as unknown as VisitJoinRow)
      );

      setContainers(formattedContainers);
    } catch (error) {
      console.error('Error fetching containers:', error);
      toast({
        title: "Error",
        description: "Failed to load containers. Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);


  const filteredContainers = containers.filter(container =>
    container.containerNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.truckNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleContainerSelect = (container: ContainerType) => {
    setSelectedContainer(container);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate with zod
    const result = gateOutSchema.safeParse({ driverName, truckNumber, fees });
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    if (!selectedContainer) {
      toast({
        title: "Error",
        description: "Please select a container",
        variant: "destructive",
      });
      return;
    }

    // Verify that the container has a booking number (should be reserved)
    if (!selectedContainer.bookingNumber) {
      toast({
        title: "Error",
        description: "Selected container is not associated with a booking",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to gate out containers.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Close the open visit for this container.
      const { error: containerError } = await supabase
        .from('container_visits')
        .update({
          status: 'out',
          gate_out_time: new Date().toISOString(),
          fees: parseFloat(fees),
          driver_name: driverName,
          truck_number: truckNumber,
          yard_block: null,
          yard_row: null,
        })
        .eq('id', selectedContainer.id);

      if (containerError) throw containerError;

      // Update booking's gated out containers count
      const { error: bookingError } = await supabase.rpc("increment_gated_out_containers", {
        booking_num: selectedContainer.bookingNumber
      });

      if (bookingError) throw bookingError;

      // Activity log
      const yardId = currentYardId();
      if (user && yardId) {
        await logActivity({
          userId: user.id,
          yardId,
          action: "gate_out",
          containerId: selectedContainer.id,
          containerNumber: selectedContainer.containerNumber,
          metadata: {
            booking_number: selectedContainer.bookingNumber,
            fees_jod: parseFloat(fees) || 0,
          },
        });
      }

      toast({
        title: "Success",
        description: `Container ${selectedContainer.containerNumber} gated out successfully`,
      });

      // Print receipt
      printReceipt();

      // Reset form and refresh containers
      setSelectedContainer(null);
      setFees("");
      setDriverName("");
      setTruckNumber("");
      setSearchTerm("");
      fetchContainers();

    } catch (error) {
      console.error('Error gating out container:', error);
      toast({
        title: "Error",
        description: "Failed to gate out container. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const printReceipt = () => {
    if (!selectedContainer) return;
    const printed = printGateOutReceipt(
      {
        id: selectedContainer.id,
        container_number: selectedContainer.containerNumber,
        container_type: selectedContainer.containerType,
        shipping_line: selectedContainer.shippingLine,
        booking_number: selectedContainer.bookingNumber || null,
        truck_number: truckNumber,
        driver_name: driverName,
        gate_in_time: selectedContainer.gateInTime,
        gate_out_time: new Date(),
        fees: Number(fees || 0),
      },
      profile,
    );
    if (!printed) {
      toast({
        title: "Pop-up blocked",
        description: "Please allow pop-ups to print the gate-out delivery note.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading containers...</div>;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader icon={Ship} title="Gate Out" subtitle="Process reserved containers for departure" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Container Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Container to Gate Out</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by container number, driver, or truck..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredContainers.map((container) => (
                <div
                  key={container.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedContainer?.id === container.id
                      ? "border-maritime bg-maritime/5"
                      : "border-border hover:border-maritime/50"
                  }`}
                  onClick={() => handleContainerSelect(container)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-lg">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.containerType} • {container.shippingLine}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                      </div>
                      <div className="text-sm text-blue-600 font-medium">
                        Booking: {container.bookingNumber}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      In yard since:<br />
                      {container.gateInTime.toLocaleDateString()}<br />
                      {container.gateInTime.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              {filteredContainers.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm ? "No containers found matching your search" : "No containers available for gate out"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Gate Out Form */}
        <Card>
          <CardHeader>
            <CardTitle>Gate Out Information</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedContainer ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="p-4 bg-muted rounded-lg">
                  <h3 className="font-medium mb-2">Selected Container</h3>
                  <div className="text-sm space-y-1">
                    <div><span className="font-medium">Container:</span> {selectedContainer.containerNumber}</div>
                    <div><span className="font-medium">Type:</span> {selectedContainer.containerType}</div>
                    <div><span className="font-medium">Line:</span> {selectedContainer.shippingLine}</div>
                    <div><span className="font-medium">Driver:</span> {selectedContainer.driverName}</div>
                    <div><span className="font-medium">Truck:</span> {selectedContainer.truckNumber}</div>
                    <div><span className="font-medium">Booking:</span> {selectedContainer.bookingNumber}</div>
                  </div>
                </div>

                <div className="space-y-4">

                  <div className="space-y-2">
                    <Label htmlFor="driverName">Driver Name *</Label>
                    <Input
                      id="driverName"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Enter driver name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="truckNumber">Truck Number *</Label>
                    <Input
                      id="truckNumber"
                      value={truckNumber}
                      onChange={(e) => setTruckNumber(e.target.value.toUpperCase())}
                      placeholder="Enter truck number"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fees">Total Fees (JOD) *</Label>
                    <Input
                      id="fees"
                      type="number"
                      step="0.01"
                      min="0"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedContainer(null);
                      setFees("");
                      setDriverName("");
                      setTruckNumber("");
                    }}
                  >
                    Clear
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-maritime hover:bg-maritime/90"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Gate Out & Print Receipt"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Please select a container from the list to gate out
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GateOut;