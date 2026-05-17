import { useCallback, useState, useEffect } from "react";
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
import bgGateOut from "@/assets/bg-gate-out.jpg";

const GateOut = () => {
  const { user } = useAuth();
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
        .from('containers')
        .select('*')
        .eq('status', 'reserved')
        .order('gate_in_time', { ascending: false });

      if (error) throw error;

      const formattedContainers: ContainerType[] = data.map(container => ({
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
        fees: container.fees ? Number(container.fees) : undefined,
      }));

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
      // Update container to 'out' status and set gate out details
      const { error: containerError } = await supabase
        .from('containers')
        .update({
          status: 'out',
          gate_out_time: new Date().toISOString(),
          fees: parseFloat(fees),
          driver_name: driverName,
          truck_number: truckNumber,
        })
        .eq('id', selectedContainer.id);

      if (containerError) throw containerError;

      // Update booking's gated out containers count
      const { error: bookingError } = await supabase.rpc("increment_gated_out_containers", {
        booking_num: selectedContainer.bookingNumber
      });

      if (bookingError) throw bookingError;

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
    
    const receiptWindow = window.open('', '_blank');
    if (receiptWindow) {
      receiptWindow.document.write(`
        <html>
          <head>
            <title>Gate Out Receipt</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
              .content { margin: 20px 0; }
              .row { margin: 10px 0; }
              .label { font-weight: bold; }
              .fees { border-top: 1px solid #ccc; margin-top: 20px; padding-top: 10px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>Container Yard Management</h2>
              <h3>GATE OUT RECEIPT</h3>
              <p>Receipt #: GO-${selectedContainer.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div class="content">
              <div class="row"><span class="label">Container Number:</span> ${selectedContainer.containerNumber}</div>
              <div class="row"><span class="label">Container Type:</span> ${selectedContainer.containerType}</div>
              <div class="row"><span class="label">Shipping Line:</span> ${selectedContainer.shippingLine}</div>
              <div class="row"><span class="label">Driver Name:</span> ${selectedContainer.driverName}</div>
              <div class="row"><span class="label">Truck Number:</span> ${selectedContainer.truckNumber}</div>
              <div class="row"><span class="label">Booking Number:</span> ${selectedContainer.bookingNumber}</div>
              <div class="row"><span class="label">Driver Name:</span> ${driverName}</div>
              <div class="row"><span class="label">Truck Number:</span> ${truckNumber}</div>
              <div class="row"><span class="label">Gate In Time:</span> ${selectedContainer.gateInTime.toLocaleString()}</div>
              <div class="row"><span class="label">Gate Out Time:</span> ${new Date().toLocaleString()}</div>
              <div class="fees">
                <div class="row"><span class="label">Total Fees:</span> $${fees}</div>
              </div>
            </div>
          </body>
        </html>
      `);
      receiptWindow.document.close();
      receiptWindow.print();
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading containers...</div>;
  }

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgGateOut})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="space-y-6 relative z-10">
      <div className="flex items-center space-x-2">
        <Ship className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">Gate Out Reserved Container</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Container Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Reserved Container to Gate Out</CardTitle>
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
                  {searchTerm ? "No reserved containers found matching your search" : "No reserved containers available for gate out"}
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
                    <Label htmlFor="fees">Total Fees (USD) *</Label>
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
    </div>
  );
};

export default GateOut;