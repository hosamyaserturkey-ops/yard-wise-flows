import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Container, Ship, Clock, Users, Calendar } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import ReserveContainerDialog from "@/components/ReserveContainerDialog";
import bgDashboard from "@/assets/bg-dashboard.jpg";

const Dashboard = () => {
  const { user } = useAuth();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [reserveDialogOpen, setReserveDialogOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'in-yard' | 'reserved' | 'out'>('all');
  const [shippingLineFilter, setShippingLineFilter] = useState<'all' | 'SLD' | 'SLG'>('all');

  useEffect(() => {
    fetchContainers();
  }, []);

  const fetchContainers = async () => {
    try {
      const { data, error } = await supabase
        .from('containers')
        .select('*')
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
        bookingId: container.booking_id,
        fees: container.fees ? Number(container.fees) : undefined,
      }));

      setContainers(formattedContainers);
    } catch (error) {
      console.error('Error fetching containers:', error);
    } finally {
      setLoading(false);
    }
  };

  const inYardCount = containers.filter(c => c.status === 'in-yard').length;
  const reservedCount = containers.filter(c => c.status === 'reserved').length;
  const outCount = containers.filter(c => c.status === 'out').length;
  const sldCount = containers.filter(c => c.shippingLine === 'SLD').length;
  const slgCount = containers.filter(c => c.shippingLine === 'SLG').length;

  const filteredContainers = containers.filter(container => {
    const statusMatch = statusFilter === 'all' || container.status === statusFilter;
    const shippingLineMatch = shippingLineFilter === 'all' || container.shippingLine === shippingLineFilter;
    return statusMatch && shippingLineMatch;
  });

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading dashboard...</div>;
  }

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgDashboard})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="space-y-6 relative z-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-industrial">Dashboard</h1>
        <div className="text-sm text-muted-foreground">
          Last updated: {new Date().toLocaleString()}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-maritime">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Containers In Yard</CardTitle>
            <Container className="h-4 w-4 text-maritime" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-maritime">{inYardCount}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-warning">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reserved</CardTitle>
            <Calendar className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{reservedCount}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-success">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Containers Out</CardTitle>
            <Ship className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{outCount}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-container">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">SLD Containers</CardTitle>
            <Users className="h-4 w-4 text-container" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-container">{sldCount}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-warning">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">SLG Containers</CardTitle>
            <Users className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{slgCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Container Activity with Filters */}
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
            onValueChange={(value) => setStatusFilter(value as "all" | "in-yard" | "reserved" | "out")}
          >
            <div className="flex justify-between items-center mb-4">
              <TabsList>
                <TabsTrigger value="all">All ({containers.length})</TabsTrigger>
                <TabsTrigger value="in-yard">In Yard ({inYardCount})</TabsTrigger>
                <TabsTrigger value="reserved">Reserved ({reservedCount})</TabsTrigger>
                <TabsTrigger value="out">Out ({outCount})</TabsTrigger>
              </TabsList>
              
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={shippingLineFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setShippingLineFilter('all')}
                >
                  All Lines
                </Button>
                <Button
                  size="sm"
                  variant={shippingLineFilter === 'SLD' ? 'default' : 'outline'}
                  onClick={() => setShippingLineFilter('SLD')}
                >
                  SLD ({sldCount})
                </Button>
                <Button
                  size="sm"
                  variant={shippingLineFilter === 'SLG' ? 'default' : 'outline'}
                  onClick={() => setShippingLineFilter('SLG')}
                >
                  SLG ({slgCount})
                </Button>
              </div>
            </div>

            <TabsContent value="all" className="space-y-4">
              {filteredContainers.map((container) => (
                <div key={container.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                  <div className="flex items-center space-x-4">
                    <Badge variant={
                      container.status === 'in-yard' ? 'default' : 
                      container.status === 'reserved' ? 'outline' :
                      'secondary'
                    }>
                      {container.status === 'in-yard' ? 'IN' : 
                       container.status === 'reserved' ? 'RESERVED' : 'OUT'}
                    </Badge>
                    <div>
                      <div className="font-medium">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                        {container.bookingNumber && ` • Booking: ${container.bookingNumber}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-medium">{container.shippingLine}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.gateInTime.toLocaleTimeString()}
                      </div>
                    </div>
                    {(container.status === 'in-yard' || container.status === 'reserved') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedContainer(container);
                          setReserveDialogOpen(true);
                        }}
                      >
                        {container.status === 'reserved' ? 'Unreserve' : 'Reserve'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {filteredContainers.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No containers found with the selected filters.
                </div>
              )}
            </TabsContent>

            <TabsContent value="in-yard" className="space-y-4">
              {filteredContainers.map((container) => (
                <div key={container.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                  <div className="flex items-center space-x-4">
                    <Badge variant="default">IN</Badge>
                    <div>
                      <div className="font-medium">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-medium">{container.shippingLine}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.gateInTime.toLocaleTimeString()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedContainer(container);
                        setReserveDialogOpen(true);
                      }}
                    >
                      Reserve
                    </Button>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="reserved" className="space-y-4">
              {filteredContainers.map((container) => (
                <div key={container.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                  <div className="flex items-center space-x-4">
                    <Badge variant="outline">RESERVED</Badge>
                    <div>
                      <div className="font-medium">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                        {container.bookingNumber && ` • Booking: ${container.bookingNumber}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-medium">{container.shippingLine}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.gateInTime.toLocaleTimeString()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedContainer(container);
                        setReserveDialogOpen(true);
                      }}
                    >
                      Unreserve
                    </Button>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="out" className="space-y-4">
              {filteredContainers.map((container) => (
                <div key={container.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                  <div className="flex items-center space-x-4">
                    <Badge variant="secondary">OUT</Badge>
                    <div>
                      <div className="font-medium">{container.containerNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.driverName} • {container.truckNumber}
                        {container.bookingNumber && ` • Booking: ${container.bookingNumber}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-medium">{container.shippingLine}</div>
                      <div className="text-sm text-muted-foreground">
                        {container.gateOutTime?.toLocaleTimeString() || 'N/A'}
                      </div>
                      {container.fees && (
                        <div className="text-sm font-medium text-success">
                          ${container.fees}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ReserveContainerDialog
        open={reserveDialogOpen}
        onOpenChange={setReserveDialogOpen}
        container={selectedContainer}
        onReserved={() => {
          fetchContainers();
          setSelectedContainer(null);
        }}
      />
      </div>
    </div>
  );
};

export default Dashboard;