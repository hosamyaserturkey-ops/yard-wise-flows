import { useCallback, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar, Search } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { SHIPPING_LINES } from "@/lib/shippingLines";
import type { ShippingLine } from "@/lib/shippingLines";

const Reports = () => {
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [filteredContainers, setFilteredContainers] = useState<ContainerType[]>([]);
  const [demurragePaid, setDemurragePaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    shippingLine: "",
    status: "",
    containerType: ""
  });

  const fetchContainers = useCallback(async () => {
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
        fees: container.fees ? Number(container.fees) : undefined,
      }));

      setContainers(formattedContainers);
      setFilteredContainers(formattedContainers);

      // Fetch demurrage payments for these containers
      const numbers = formattedContainers.map((c) => c.containerNumber);
      if (numbers.length > 0) {
        const { data: paymentsData } = await supabase
          .from("demurrage_payments")
          .select("container_number, total_collected")
          .in("container_number", numbers);
        const paidMap: Record<string, number> = {};
        (paymentsData ?? []).forEach((p) => {
          paidMap[p.container_number] =
            (paidMap[p.container_number] ?? 0) + Number(p.total_collected ?? 0);
        });
        setDemurragePaid(paidMap);
      }
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


  // Live filter — runs on every change to filters / search.
  useEffect(() => {
    let filtered = [...containers];

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      filtered = filtered.filter(c => c.gateInTime >= fromDate);
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(c => c.gateInTime <= toDate);
    }

    if (filters.shippingLine && filters.shippingLine !== "all") {
      filtered = filtered.filter(c => c.shippingLine === filters.shippingLine);
    }

    if (filters.status && filters.status !== "all") {
      filtered = filtered.filter(c => c.status === filters.status);
    }

    if (filters.containerType && filters.containerType !== "all") {
      filtered = filtered.filter(c => c.containerType === filters.containerType);
    }

    const q = searchTerm.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(c =>
        c.containerNumber.toLowerCase().includes(q) ||
        c.driverName?.toLowerCase().includes(q) ||
        c.truckNumber?.toLowerCase().includes(q) ||
        c.bookingNumber?.toLowerCase().includes(q) ||
        c.shippingLine?.toLowerCase().includes(q),
      );
    }

    setFilteredContainers(filtered);
  }, [containers, filters, searchTerm]);

  const clearFilters = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      shippingLine: "all",
      status: "all",
      containerType: "all"
    });
    setSearchTerm("");
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
      "Gate-Out Fees (JOD)",
      "Demurrage Paid (JOD)"
    ];

    const escape = (v: unknown) => {
      const s = String(v ?? "");
      // Neutralise CSV formula injection: prefix values starting with formula
      // triggers so spreadsheet apps treat them as text, not formulas.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };

    const csvContent = [
      headers.join(","),
      ...filteredContainers.map(container =>
        [
          container.containerNumber,
          container.containerType,
          container.shippingLine,
          container.driverName,
          container.truckNumber,
          container.gateInTime.toISOString(),
          container.gateOutTime?.toISOString() || "",
          container.status,
          container.bookingNumber || "",
          container.fees ?? "",
          demurragePaid[container.containerNumber]?.toFixed(2) ?? "",
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `container_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const totalFees = filteredContainers.reduce((sum, container) => sum + (container.fees || 0), 0);
  const totalDemurrage = filteredContainers.reduce(
    (sum, c) => sum + (demurragePaid[c.containerNumber] || 0),
    0,
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={FileText}
        title="Reports"
        subtitle={`${filteredContainers.length} container${filteredContainers.length !== 1 ? "s" : ""} shown`}
        action={
          <Button onClick={exportToCSV} className="bg-success hover:bg-success/90">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calendar className="h-5 w-5" />
            <span>Filter Reports</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by container, driver, truck, booking, or line…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
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
                  <SelectItem value="all">All Lines</SelectItem>
                  {SHIPPING_LINES.map((sl) => (
                    <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                  ))}
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
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="in-yard">In Yard</SelectItem>
                  <SelectItem value="reserved">Reserved</SelectItem>
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
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="20FT">20FT</SelectItem>
                  <SelectItem value="40FT">40FT</SelectItem>
                  <SelectItem value="40HC">40HC</SelectItem>
                  <SelectItem value="45FT">45FT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
            <div className="text-2xl font-bold text-blue-600">
              {filteredContainers.filter(c => c.status === 'reserved').length}
            </div>
            <div className="text-sm text-muted-foreground">Reserved</div>
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
            <div className="text-2xl font-bold text-container">{totalFees.toFixed(2)} JOD</div>
            <div className="text-sm text-muted-foreground">Total Fees</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-success">{totalDemurrage.toFixed(2)} JOD</div>
            <div className="text-sm text-muted-foreground">Demurrage Collected</div>
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
                <TableHead>Demurrage</TableHead>
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
                    {container.status === 'in-yard' ? (
                      <Badge variant="default">In Yard</Badge>
                    ) : container.status === 'reserved' ? (
                      <Badge className="bg-blue-500/20 text-blue-600 border-blue-400/30">Reserved</Badge>
                    ) : (
                      <Badge variant="secondary">Out</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {container.bookingNumber || "-"}
                  </TableCell>
                  <TableCell>
                    {container.fees ? `${container.fees.toFixed(2)} JOD` : "-"}
                  </TableCell>
                  <TableCell>
                    {demurragePaid[container.containerNumber] != null ? (
                      <Badge className="bg-success/10 text-success border-success/30">
                        {demurragePaid[container.containerNumber].toFixed(2)} JOD
                      </Badge>
                    ) : (
                      "-"
                    )}
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