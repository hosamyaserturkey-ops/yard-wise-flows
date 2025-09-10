import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Container, Ship, Clock, Users } from "lucide-react";
import { Container as ContainerType } from "@/types/container";

const Dashboard = () => {
  const [containers, setContainers] = useState<ContainerType[]>([]);

  // Mock data - in real app this would come from database
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
        id: "2",
        containerNumber: "SLGX789012",
        containerType: "40FT",
        shippingLine: "SLG",
        driverName: "Mike Johnson",
        truckNumber: "TRK002",
        gateInTime: new Date("2024-01-15T11:15:00"),
        gateOutTime: new Date("2024-01-15T14:30:00"),
        status: "out",
        bookingNumber: "BK001",
        fees: 150
      }
    ];
    setContainers(mockContainers);
  }, []);

  const inYardCount = containers.filter(c => c.status === 'in-yard').length;
  const outCount = containers.filter(c => c.status === 'out').length;
  const sldCount = containers.filter(c => c.shippingLine === 'SLD').length;
  const slgCount = containers.filter(c => c.shippingLine === 'SLG').length;

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
            {containers.slice(0, 5).map((container) => (
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;