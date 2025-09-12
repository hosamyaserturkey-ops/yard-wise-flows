import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Container, Ship, Clock, Users } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const Dashboard = () => {
  const { user } = useAuth();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [loading, setLoading] = useState(true);

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
        shippingLine: container.shipping_line as 'SLD' | 'SLG',
        driverName: container.driver_name,
        truckNumber: container.truck_number,
        gateInTime: new Date(container.gate_in_time),
        gateOutTime: container.gate_out_time ? new Date(container.gate_out_time) : undefined,
        status: container.status as 'in-yard' | 'out',
        bookingNumber: container.booking_number,
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
  const outCount = containers.filter(c => c.status === 'out').length;
  const sldCount = containers.filter(c => c.shippingLine === 'SLD').length;
  const slgCount = containers.filter(c => c.shippingLine === 'SLG').length;

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
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

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-maritime" />
            <span>Recent Container Activity</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {containers.slice(0, 10).map((container) => (
              <div key={container.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                <div className="flex items-center space-x-4">
                  <Badge variant={container.status === 'in-yard' ? 'default' : 'secondary'}>
                    {container.status === 'in-yard' ? 'IN' : 'OUT'}
                  </Badge>
                  <div>
                    <div className="font-medium">{container.containerNumber}</div>
                    <div className="text-sm text-muted-foreground">
                      {container.driverName} • {container.truckNumber}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{container.shippingLine}</div>
                  <div className="text-sm text-muted-foreground">
                    {container.gateInTime.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {containers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No container activity found. Start by gating in some containers.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;