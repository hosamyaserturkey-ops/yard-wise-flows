import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Container } from "lucide-react";
import { GateInData } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import bgGateIn from "@/assets/bg-gate-in.jpg";

const GateIn = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState<GateInData>({
    containerNumber: "",
    containerType: "",
    shippingLine: "SLD",
    driverName: "",
    truckNumber: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to gate in containers.",
        variant: "destructive",
      });
      return;
    }

    // Validate form
    if (!formData.containerNumber || !formData.containerType || !formData.driverName || !formData.truckNumber) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Check if container already exists in yard
      const { data: existingContainer } = await supabase
        .from('containers')
        .select('id')
        .eq('container_number', formData.containerNumber)
        .eq('status', 'in-yard')
        .maybeSingle();
        
      if (existingContainer) {
        toast({
          title: "Container Already In Yard",
          description: "This container is already gated in.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      const { data, error } = await supabase
        .from('containers')
        .insert({
          container_number: formData.containerNumber,
          container_type: formData.containerType,
          shipping_line: formData.shippingLine,
          driver_name: formData.driverName,
          truck_number: formData.truckNumber,
          created_by: user.id,
        })
        .select()
        .single();
        
      if (error) throw error;
      
      toast({
        title: "Success",
        description: `Container ${formData.containerNumber} gated in successfully`,
      });

      // Print receipt
      printReceipt(data);

      // Reset form
      setFormData({
        containerNumber: "",
        containerType: "",
        shippingLine: "SLD",
        driverName: "",
        truckNumber: "",
      });
      
    } catch (error) {
      console.error('Error gating in container:', error);
      toast({
        title: "Error",
        description: "Failed to gate in container. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const printReceipt = (containerData: any) => {
    const receiptWindow = window.open('', '_blank');
    if (receiptWindow) {
      receiptWindow.document.write(`
        <html>
          <head>
            <title>Gate In Receipt</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
              .content { margin: 20px 0; }
              .row { margin: 10px 0; }
              .label { font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>Container Yard Management</h2>
              <h3>GATE IN RECEIPT</h3>
              <p>Receipt #: GI-${containerData.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div class="content">
              <div class="row"><span class="label">Container Number:</span> ${containerData.container_number}</div>
              <div class="row"><span class="label">Container Type:</span> ${containerData.container_type}</div>
              <div class="row"><span class="label">Shipping Line:</span> ${containerData.shipping_line}</div>
              <div class="row"><span class="label">Driver Name:</span> ${containerData.driver_name}</div>
              <div class="row"><span class="label">Truck Number:</span> ${containerData.truck_number}</div>
              <div class="row"><span class="label">Gate In Time:</span> ${new Date(containerData.gate_in_time).toLocaleString()}</div>
            </div>
          </body>
        </html>
      `);
      receiptWindow.document.close();
      receiptWindow.print();
    }
  };

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgGateIn})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="max-w-2xl mx-auto space-y-6 relative z-10">
      <div className="flex items-center space-x-2">
        <Container className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">Gate In Container</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Container Entry Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="containerNumber">Container Number *</Label>
                <Input
                  id="containerNumber"
                  value={formData.containerNumber}
                  onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g., SLDX123456"
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="containerType">Container Type *</Label>
                <Select
                  value={formData.containerType}
                  onValueChange={(value) => setFormData({ ...formData, containerType: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select container type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20FT">20FT Standard</SelectItem>
                    <SelectItem value="40FT">40FT Standard</SelectItem>
                    <SelectItem value="40HC">40FT High Cube</SelectItem>
                    <SelectItem value="45FT">45FT High Cube</SelectItem>
                    <SelectItem value="20FR">20FT Reefer</SelectItem>
                    <SelectItem value="40FR">40FT Reefer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="shippingLine">Shipping Line *</Label>
                <Select
                  value={formData.shippingLine}
                  onValueChange={(value: 'SLD' | 'SLG') => setFormData({ ...formData, shippingLine: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SLD">SLD</SelectItem>
                    <SelectItem value="SLG">SLG</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="driverName">Driver Name *</Label>
                <Input
                  id="driverName"
                  value={formData.driverName}
                  onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                  placeholder="Enter driver's full name"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="truckNumber">Truck Number *</Label>
                <Input
                  id="truckNumber"
                  value={formData.truckNumber}
                  onChange={(e) => setFormData({ ...formData, truckNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g., TRK001"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormData({
                  containerNumber: "",
                  containerType: "",
                  shippingLine: "SLD",
                  driverName: "",
                  truckNumber: "",
                })}
              >
                Clear Form
              </Button>
              <Button 
                type="submit" 
                className="bg-maritime hover:bg-maritime/90"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Processing..." : "Gate In & Print Receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  );
};

export default GateIn;