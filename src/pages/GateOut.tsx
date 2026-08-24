import { useCallback, useEffect, useMemo, useState } from "react";
import { printGateOutReceipt } from "@/lib/gateOutReceipt";
import { GateMotionOverlay } from "@/components/GateMotionOverlay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Ship, Search, RefreshCw, X, PackageSearch, ArrowRight } from "lucide-react";
import type { Booking } from "@/types/booking";
import { Container as ContainerType } from "@/types/container";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { gateOutSchema } from "@/lib/validation";
import { PageHeader } from "@/components/PageHeader";
import { logActivity } from "@/lib/activityLog";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";
import {
  dwellDays,
  formatDwell,
  formatJod,
  matchesGateOutSearch,
  normalizeFees,
} from "@/lib/gateOut";

type FieldErrors = Partial<
  Record<"bookingNumber" | "sealNumber" | "driverName" | "truckNumber" | "fees", string>
>;

const GateOut = () => {
  const { user, profile, currentYardId } = useAuth();
  const { toast } = useToast();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [sealNumber, setSealNumber] = useState("");
  const [fees, setFees] = useState("");
  const [driverName, setDriverName] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gateMotion, setGateMotion] = useState<string | null>(null);

  // Fetch the open visits that can still leave the yard. Scoped to the active
  // yard so a super admin who picked a yard from the switcher doesn't see (and
  // gate out) containers standing in a different yard.
  const fetchContainers = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const yardId = currentYardId();
        let query = supabase
          .from('container_visits')
          .select(VISIT_WITH_CONTAINER)
          .in('status', ['reserved', 'in-yard'])
          .is('gate_out_time', null)
          .order('gate_in_time', { ascending: false });
        if (yardId) query = query.eq('yard_id', yardId);

        const { data, error } = await query;

        if (error) throw error;

        const formattedContainers: ContainerType[] = (data ?? []).map((row) =>
          mapVisit(row as unknown as VisitJoinRow)
        );

        setContainers(formattedContainers);
        // Re-point the selection at the refreshed row (its booking or location
        // may have changed) and drop it if the visit is gone.
        setSelectedContainer((prev) =>
          prev ? formattedContainers.find((c) => c.id === prev.id) ?? null : null
        );
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
    },
    [toast, currentYardId]
  );

  // Bookings a container can be released against. Only 'active' ones: the
  // Bookings page auto-completes a booking once its containers are all out.
  const fetchBookings = useCallback(async () => {
    try {
      const yardId = currentYardId();
      let query = supabase
        .from("bookings")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (yardId) query = query.eq("yard_id", yardId);

      const { data, error } = await query;
      if (error) throw error;

      setBookings(
        (data ?? []).map((booking) => ({
          ...booking,
          status: booking.status as "active" | "completed" | "cancelled",
          created_at: new Date(booking.created_at),
          updated_at: new Date(booking.updated_at),
        })),
      );
    } catch (error) {
      console.error("Error fetching bookings:", error);
      toast({
        title: "Error",
        description: "Failed to load bookings. You can still search, but gate-out needs one.",
        variant: "destructive",
      });
    }
  }, [toast, currentYardId]);

  useEffect(() => {
    fetchContainers();
    fetchBookings();
  }, [fetchContainers, fetchBookings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchContainers({ silent: true }), fetchBookings()]);
    setRefreshing(false);
  };

  const filteredContainers = useMemo(
    () => containers.filter((container) => matchesGateOutSearch(container, searchTerm)),
    [containers, searchTerm]
  );

  const handleContainerSelect = (container: ContainerType) => {
    setSelectedContainer(container);
    // A reserved container already names its booking — preselect it, but leave
    // it editable: the container may be released against a different one.
    setBookingId(container.bookingId ?? "");
    setErrors({});
  };

  const selectedBooking = bookings.find((b) => b.id === bookingId);
  // The reservation's booking may be missing from the dropdown (completed or
  // cancelled since). Keep its number so the operator sees what is attached.
  const attachedBookingNumber =
    selectedBooking?.booking_number ??
    (bookingId && bookingId === selectedContainer?.bookingId
      ? selectedContainer?.bookingNumber ?? ""
      : "");

  const resetForm = () => {
    setSelectedContainer(null);
    setBookingId("");
    setSealNumber("");
    setFees("");
    setDriverName("");
    setTruckNumber("");
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedContainer) {
      toast({
        title: "Error",
        description: "Please select a container",
        variant: "destructive",
      });
      return;
    }

    // Validate with zod — errors land next to the field that caused them.
    const result = gateOutSchema.safeParse({
      bookingNumber: attachedBookingNumber,
      sealNumber,
      driverName,
      truckNumber,
      fees,
    });
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors({
        bookingNumber: fieldErrors.bookingNumber?.[0],
        sealNumber: fieldErrors.sealNumber?.[0],
        driverName: fieldErrors.driverName?.[0],
        truckNumber: fieldErrors.truckNumber?.[0],
        fees: fieldErrors.fees?.[0],
      });
      return;
    }

    const feeAmount = normalizeFees(result.data.fees);
    if (feeAmount === null) {
      setErrors({ fees: "Enter a valid amount" });
      return;
    }
    setErrors({});

    const driver = result.data.driverName;
    const truck = result.data.truckNumber.trim();
    const seal = result.data.sealNumber;
    const booking = result.data.bookingNumber;

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
      // Close the open visit for this container. `gate_out_time is null` keeps
      // this idempotent: if another operator released it first the update
      // matches no row, and `select` lets us detect that instead of printing a
      // ticket for a gate-out that never happened.
      const { data: updated, error: containerError } = await supabase
        .from('container_visits')
        .update({
          status: 'out',
          gate_out_time: new Date().toISOString(),
          // Who released the container — printed on the gate-out ticket so a
          // later reprint still names this operator, not the person reprinting.
          gated_out_by: user.id,
          fees: feeAmount,
          driver_name: driver,
          truck_number: truck,
          // Attached at the gate: the container leaves against this booking and
          // under this seal, whether or not it was reserved beforehand.
          booking_id: bookingId || selectedContainer.bookingId || null,
          booking_number: booking,
          seal_number: seal,
          yard_block: null,
          yard_row: null,
        })
        .eq('id', selectedContainer.id)
        .is('gate_out_time', null)
        .select('id');

      if (containerError) throw containerError;

      if (!updated || updated.length === 0) {
        toast({
          title: "Container not released",
          description:
            `${selectedContainer.containerNumber} was already gated out, or you don't have permission to release it in this yard.`,
          variant: "destructive",
        });
        await fetchContainers({ silent: true });
        return;
      }

      // Bump the count on the booking the container actually left against,
      // which is not necessarily the one it was reserved for. The container is
      // already out at this point, so a counter failure is reported on its own
      // rather than failing the gate-out and losing the ticket.
      const { error: bookingError } = await supabase.rpc("increment_gated_out_containers", {
        booking_num: booking
      });

      if (bookingError) {
        console.error('Error incrementing booking count:', bookingError);
        toast({
          title: "Booking count not updated",
          description: `Container released, but booking ${booking} could not be updated. Check the booking.`,
          variant: "destructive",
        });
      }

      // Activity log — prefer the visit's own yard so a super admin viewing
      // "all yards" still gets the action logged against the right yard.
      const yardId = selectedContainer.yardId ?? currentYardId();
      if (yardId) {
        await logActivity({
          userId: user.id,
          yardId,
          action: "gate_out",
          containerId: selectedContainer.id,
          containerNumber: selectedContainer.containerNumber,
          metadata: {
            booking_number: booking,
            seal_number: seal,
            fees_jod: feeAmount,
          },
        });
      }

      toast({
        title: "Success",
        description: `Container ${selectedContainer.containerNumber} gated out successfully`,
      });
      setGateMotion(selectedContainer.containerNumber);

      // Print receipt
      printReceipt(selectedContainer, { driver, truck, seal, booking, feeAmount });

      // Reset form and refresh containers
      resetForm();
      setSearchTerm("");
      await fetchContainers({ silent: true });

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

  const printReceipt = (
    container: ContainerType,
    released: { driver: string; truck: string; seal: string; booking: string; feeAmount: number },
  ) => {
    const { driver, truck, seal, booking, feeAmount } = released;
    const printed = printGateOutReceipt(
      {
        ticket_number: container.ticketNumber,
        container_number: container.containerNumber,
        container_type: container.containerType,
        shipping_line: container.shippingLine,
        booking_number: booking,
        seal_number: seal,
        truck_number: truck,
        driver_name: driver,
        gate_in_time: container.gateInTime,
        gate_out_time: new Date(),
        fees: feeAmount,
      },
      profile,
    );
    if (!printed) {
      toast({
        title: "Pop-up blocked",
        description:
          "Allow pop-ups and reprint the delivery note from the container's detail dialog.",
        variant: "destructive",
      });
    }
  };

  const feePreview = normalizeFees(fees);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      {gateMotion && (
        <GateMotionOverlay
          direction="out"
          containerNumber={gateMotion}
          onDone={() => setGateMotion(null)}
        />
      )}
      <PageHeader icon={Ship} title="Gate Out" subtitle="Release containers from the yard" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Container Selection */}
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                Select Container to Gate Out
                {!loading && (
                  <Badge variant="secondary" className="font-normal">
                    {filteredContainers.length}
                    {searchTerm && ` / ${containers.length}`}
                  </Badge>
                )}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={loading || refreshing}
                aria-label="Refresh container list"
                title="Refresh container list"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by container, driver, truck, booking or line…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-10"
                aria-label="Search containers"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredContainers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <PackageSearch className="h-8 w-8 opacity-60" />
                <p>
                  {searchTerm
                    ? "No containers match your search"
                    : "No containers are currently in the yard"}
                </p>
                {searchTerm && (
                  <Button type="button" variant="link" size="sm" onClick={() => setSearchTerm("")}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <ScrollArea className="h-[26rem] pr-3">
                <div className="space-y-2">
                  {filteredContainers.map((container) => {
                    const isSelected = selectedContainer?.id === container.id;
                    const days = dwellDays(container.gateInTime);
                    return (
                      <button
                        key={container.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleContainerSelect(container)}
                        className={`w-full text-left p-4 border rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          isSelected
                            ? "border-maritime bg-maritime/5"
                            : "border-border hover:border-maritime/50 hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-lg">
                                {container.containerNumber}
                              </span>
                              <StatusBadge status={container.status} short dot />
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {container.containerType} • {container.shippingLine}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              In: {container.driverName || "—"} • {container.truckNumber || "—"}
                            </div>
                            {container.bookingNumber ? (
                              <div className="text-sm text-maritime font-medium truncate">
                                Booking: {container.bookingNumber}
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground">No booking</div>
                            )}
                          </div>
                          <div className="shrink-0 text-right text-xs text-muted-foreground">
                            <div className="text-sm font-semibold text-foreground">
                              {formatDwell(days)}
                            </div>
                            <div>in yard</div>
                            <div className="mt-1">
                              {container.gateInTime.toLocaleDateString()}
                              <br />
                              {container.gateInTime.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Gate Out Form */}
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Gate Out Information</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedContainer ? (
              // noValidate: every rule is enforced by zod below so the operator
              // gets one consistent inline message instead of a native browser
              // bubble (the old step/min attributes blocked submit outright).
              <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-medium">Selected Container</h3>
                    <StatusBadge status={selectedContainer.status} dot />
                  </div>
                  <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Container</dt>
                    <dd className="font-mono font-medium">{selectedContainer.containerNumber}</dd>
                    <dt className="text-muted-foreground">Type / Line</dt>
                    <dd>{selectedContainer.containerType} • {selectedContainer.shippingLine}</dd>
                    <dt className="text-muted-foreground">Reserved for</dt>
                    <dd>{selectedContainer.bookingNumber || "— (not reserved)"}</dd>
                    <dt className="text-muted-foreground">In yard</dt>
                    <dd>
                      {formatDwell(dwellDays(selectedContainer.gateInTime))} · since{" "}
                      {selectedContainer.gateInTime.toLocaleDateString()}
                    </dd>
                    <dt className="text-muted-foreground">Gate-in driver</dt>
                    <dd>{selectedContainer.driverName || "—"}</dd>
                    <dt className="text-muted-foreground">Gate-in truck</dt>
                    <dd>{selectedContainer.truckNumber || "—"}</dd>
                  </dl>
                  {(selectedContainer.driverName || selectedContainer.truckNumber) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        setDriverName(selectedContainer.driverName);
                        setTruckNumber(selectedContainer.truckNumber.toUpperCase());
                        setErrors((prev) => ({ ...prev, driverName: undefined, truckNumber: undefined }));
                      }}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      Same driver & truck as gate-in
                    </Button>
                  )}
                </div>

                <div className="space-y-4">

                  <div className="space-y-2">
                    <Label htmlFor="bookingNumber">Booking Number *</Label>
                    <Select
                      value={bookingId}
                      onValueChange={(value) => {
                        setBookingId(value);
                        setErrors((prev) => ({ ...prev, bookingNumber: undefined }));
                      }}
                    >
                      <SelectTrigger
                        id="bookingNumber"
                        aria-invalid={!!errors.bookingNumber}
                        aria-describedby={errors.bookingNumber ? "bookingNumber-error" : undefined}
                      >
                        <SelectValue placeholder="Attach a booking…" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* A reservation against a booking that has since been
                            completed or cancelled is still shown, so the
                            container can leave under the number it was held for. */}
                        {selectedContainer.bookingId &&
                          selectedContainer.bookingNumber &&
                          !bookings.some((b) => b.id === selectedContainer.bookingId) && (
                            <SelectItem value={selectedContainer.bookingId}>
                              {selectedContainer.bookingNumber} — reserved (inactive)
                            </SelectItem>
                          )}
                        {bookings.map((booking) => (
                          <SelectItem key={booking.id} value={booking.id}>
                            {booking.booking_number} — {booking.customer_name} (
                            {booking.gated_out_containers}/{booking.total_containers} out)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.bookingNumber ? (
                      <p id="bookingNumber-error" className="text-sm text-destructive">
                        {errors.bookingNumber}
                      </p>
                    ) : bookings.length === 0 && !selectedContainer.bookingNumber ? (
                      <p className="text-sm text-muted-foreground">
                        No active bookings in this yard — create one on the Bookings page first.
                      </p>
                    ) : selectedContainer.bookingId && bookingId !== selectedContainer.bookingId ? (
                      <p className="text-sm text-warning">
                        Releasing against a different booking than the reservation
                        ({selectedContainer.bookingNumber}).
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sealNumber">Seal Number *</Label>
                    <Input
                      id="sealNumber"
                      value={sealNumber}
                      onChange={(e) => {
                        setSealNumber(e.target.value.toUpperCase().trim());
                        setErrors((prev) => ({ ...prev, sealNumber: undefined }));
                      }}
                      placeholder="Seal fitted to the container doors"
                      autoComplete="off"
                      className="font-mono"
                      aria-invalid={!!errors.sealNumber}
                      aria-describedby={errors.sealNumber ? "sealNumber-error" : undefined}
                    />
                    {errors.sealNumber && (
                      <p id="sealNumber-error" className="text-sm text-destructive">
                        {errors.sealNumber}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="driverName">Collecting Driver *</Label>
                    <Input
                      id="driverName"
                      value={driverName}
                      onChange={(e) => {
                        setDriverName(e.target.value);
                        setErrors((prev) => ({ ...prev, driverName: undefined }));
                      }}
                      placeholder="Name of the driver taking the container out"
                      autoComplete="off"
                      aria-invalid={!!errors.driverName}
                      aria-describedby={errors.driverName ? "driverName-error" : undefined}
                    />
                    {errors.driverName && (
                      <p id="driverName-error" className="text-sm text-destructive">
                        {errors.driverName}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="truckNumber">Collecting Truck Number *</Label>
                    <Input
                      id="truckNumber"
                      value={truckNumber}
                      onChange={(e) => {
                        setTruckNumber(e.target.value.toUpperCase());
                        setErrors((prev) => ({ ...prev, truckNumber: undefined }));
                      }}
                      placeholder="Plate of the collecting truck"
                      autoComplete="off"
                      aria-invalid={!!errors.truckNumber}
                      aria-describedby={errors.truckNumber ? "truckNumber-error" : undefined}
                    />
                    {errors.truckNumber && (
                      <p id="truckNumber-error" className="text-sm text-destructive">
                        {errors.truckNumber}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fees">Total Fees (JOD) *</Label>
                    <div className="relative">
                      <Input
                        id="fees"
                        type="number"
                        // "any" rather than a fixed step: a stepped input rejects
                        // an off-grid amount at the browser level. The value is
                        // rounded to three decimals (fils) on submit instead.
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={fees}
                        onChange={(e) => {
                          setFees(e.target.value);
                          setErrors((prev) => ({ ...prev, fees: undefined }));
                        }}
                        placeholder="0.000"
                        className="pr-14"
                        aria-invalid={!!errors.fees}
                        aria-describedby={errors.fees ? "fees-error" : "fees-hint"}
                      />
                      <span className="absolute right-3 top-2.5 text-sm text-muted-foreground pointer-events-none">
                        JOD
                      </span>
                    </div>
                    {errors.fees ? (
                      <p id="fees-error" className="text-sm text-destructive">
                        {errors.fees}
                      </p>
                    ) : (
                      <p id="fees-hint" className="text-sm text-muted-foreground">
                        {feePreview !== null
                          ? `Ticket will show ${formatJod(feePreview)} JOD`
                          : "Enter 0 if nothing is collected at the gate"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={resetForm}
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
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Ship className="h-8 w-8 opacity-60" />
                <p>Select a container from the list to gate it out</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GateOut;
