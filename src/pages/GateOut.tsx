import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Ship, Search } from "lucide-react";
import { Container as ContainerType } from "@/types/container";

const GateOut = () => {
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [bookingNumber, setBookingNumber] = useState("");
  const [fees, setFees] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Mock data - containers in yard
  useEffect(() => {
    const mockContainers: ContainerType[] = [
      {
        id: "1",
        containerNumber: "SLDX123456",
        containerType: "20FT",
        shippingLine: "SLD",
        driverName: "John Smith",
        truckNumber: "TRK001",
        gateInTime: new Date("2024-01-15T10:30:00"),
        status: "in-yard"
      },
      {
        id: "3",
        containerNumber: "SLGX345678",
        containerType: "40FT",
        shippingLine: "SLG",
        driverName: "Sarah Wilson",
        truckNumber: "TRK003",
        gateInTime: new Date("2024-01-15T12:00:00"),
        status: "in-yard"
      }
    ];
    setContainers(mockContainers.filter(c => c.status === 'in-yard'));
  }, []);

  const filteredContainers = containers.filter(container =>
    container.containerNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.truckNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleContainerSelect = (container: ContainerType) => {
    setSelectedContainer(container);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedContainer || !bookingNumber || !fees) {
      toast({
        title: "Error",
        description: "Please select a container and fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Process gate out (in real app, update database)
    console.log("Gate Out Data:", {
      container: selectedContainer,
      bookingNumber,
      fees: parseFloat(fees)
    });
    
    toast({
      title: "Success",
      description: `Container ${selectedContainer.containerNumber} gated out successfully`,
    });

    // Print receipt
    printReceipt();

    // Reset form
    setSelectedContainer(null);
    setBookingNumber("");
    setFees("");
    setSearchTerm("");
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
            </div>
            <div class="content">
              <div class="row"><span class="label">Container Number:</span> ${selectedContainer.containerNumber}</div>
              <div class="row"><span class="label">Container Type:</span> ${selectedContainer.containerType}</div>
              <div class="row"><span class="label">Shipping Line:</span> ${selectedContainer.shippingLine}</div>
              <div class="row"><span class="label">Driver Name:</span> ${selectedContainer.driverName}</div>
              <div class="row"><span class="label">Truck Number:</span> ${selectedContainer.truckNumber}</div>
              <div class="row"><span class="label">Booking Number:</span> ${bookingNumber}</div>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Ship className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">Gate Out Container</h1>
      </div>

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
                  No containers found in yard
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
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="bookingNumber">Booking Number *</Label>
                    <Input
                      id="bookingNumber"
                      value={bookingNumber}
                      onChange={(e) => setBookingNumber(e.target.value.toUpperCase())}
                      placeholder="e.g., BK001234"
                      className="font-mono"
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
                      setBookingNumber("");
                      setFees("");
                    }}
                  >
                    Clear
                  </Button>
                  <Button type="submit" className="bg-maritime hover:bg-maritime/90">
                    Gate Out & Print Receipt
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