import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Reports = () => {
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [filteredContainers, setFilteredContainers] = useState<ContainerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    shippingLine: "",
    status: "",
    containerType: ""
  });

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
      setFilteredContainers(formattedContainers);
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
  };

  const applyFilters = () => {
    let filtered = [...containers];

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      filtered = filtered.filter(c => c.gateInTime >= fromDate);
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999); // End of day
      filtered = filtered.filter(c => c.gateInTime <= toDate);
    }

    if (filters.shippingLine) {
      filtered = filtered.filter(c => c.shippingLine === filters.shippingLine);
    }

    if (filters.status) {
      filtered = filtered.filter(c => c.status === filters.status);
    }

    if (filters.containerType) {
      filtered = filtered.filter(c => c.containerType === filters.containerType);
    }

    setFilteredContainers(filtered);
  };

  const clearFilters = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      shippingLine: "",
      status: "",
      containerType: ""
    });
    setFilteredContainers(containers);
  };

  const exportToCSV = () => {
    const headers = [
      "Container Number",
      "Type",
      "Shipping Line",
      "Driver Name",
      "Truck Number",
      "Gate In Time",
      "Gate Out Time",
      "Status",
      "Booking Number",
      "Fees"
    ];

    const csvContent = [
      headers.join(","),
      ...filteredContainers.map(container => [
        container.containerNumber,
        container.containerType,
        container.shippingLine,
        container.driverName,
        container.truckNumber,
        container.gateInTime.toISOString(),
        container.gateOutTime?.toISOString() || "",
        container.status,
        container.bookingNumber || "",
        container.fees || ""
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `container_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const totalFees = filteredContainers.reduce((sum, container) => sum + (container.fees || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <FileText className="h-8 w-8 text-maritime" />
          <h1 className="text-3xl font-bold text-industrial">Reports</h1>
        </div>
        <Button onClick={exportToCSV} className="bg-success hover:bg-success/90">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calendar className="h-5 w-5" />
            <span>Filter Reports</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom">From Date</Label>
              <Input
                id="dateFrom"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">To Date</Label>
              <Input
                id="dateTo"
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Shipping Line</Label>
              <Select value={filters.shippingLine} onValueChange={(value) => setFilters({ ...filters, shippingLine: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Lines</SelectItem>
                  <SelectItem value="SLD">SLD</SelectItem>
                  <SelectItem value="SLG">SLG</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Status</SelectItem>
                  <SelectItem value="in-yard">In Yard</SelectItem>
                  <SelectItem value="out">Out</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Container Type</Label>
              <Select value={filters.containerType} onValueChange={(value) => setFilters({ ...filters, containerType: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Types</SelectItem>
                  <SelectItem value="20FT">20FT</SelectItem>
                  <SelectItem value="40FT">40FT</SelectItem>
                  <SelectItem value="40HC">40HC</SelectItem>
                  <SelectItem value="45FT">45FT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end space-x-4 mt-4">
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
            <Button onClick={applyFilters} className="bg-maritime hover:bg-maritime/90">
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-maritime">{filteredContainers.length}</div>
            <div className="text-sm text-muted-foreground">Total Containers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-success">
              {filteredContainers.filter(c => c.status === 'in-yard').length}
            </div>
            <div className="text-sm text-muted-foreground">In Yard</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-warning">
              {filteredContainers.filter(c => c.status === 'out').length}
            </div>
            <div className="text-sm text-muted-foreground">Gated Out</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-container">${totalFees.toFixed(2)}</div>
            <div className="text-sm text-muted-foreground">Total Fees</div>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>Container Activity Report</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Shipping Line</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead>Gate In</TableHead>
                <TableHead>Gate Out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead>Fees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredContainers.map((container) => (
                <TableRow key={container.id}>
                  <TableCell className="font-mono font-medium">
                    {container.containerNumber}
                  </TableCell>
                  <TableCell>{container.containerType}</TableCell>
                  <TableCell>
                    <Badge variant={container.shippingLine === 'SLD' ? 'default' : 'secondary'}>
                      {container.shippingLine}
                    </Badge>
                  </TableCell>
                  <TableCell>{container.driverName}</TableCell>
                  <TableCell className="font-mono">{container.truckNumber}</TableCell>
                  <TableCell className="text-sm">
                    {container.gateInTime.toLocaleDateString()}<br />
                    {container.gateInTime.toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-sm">
                    {container.gateOutTime ? (
                      <>
                        {container.gateOutTime.toLocaleDateString()}<br />
                        {container.gateOutTime.toLocaleTimeString()}
                      </>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={container.status === 'in-yard' ? 'default' : 'secondary'}>
                      {container.status === 'in-yard' ? 'In Yard' : 'Out'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {container.bookingNumber || "-"}
                  </TableCell>
                  <TableCell>
                    {container.fees ? `$${container.fees.toFixed(2)}` : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredContainers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No containers found matching the current filters
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;