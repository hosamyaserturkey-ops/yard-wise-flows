import { supabase } from "@/integrations/supabase/client";
import { daysInLot } from "@/lib/carLot";
import type { CarTicketData, CarTicketKind, TicketCondition } from "@/lib/carTicket";

/**
 * Everything a ticket shows, read with the signed-in user's own login (so a
 * ticket can never contain more than that person is allowed to see).
 * A reception ticket also carries the condition recorded by the closed
 * arrival inspection, so the driver signs for what was actually found.
 */
export async function loadCarTicket(visitId: string, kind: CarTicketKind): Promise<CarTicketData> {
  const { data: visit, error } = await supabase
    .from("vehicle_visits")
    .select(
      "id, ticket_number, gate_in_time, gate_out_time, lot_zone, lot_slot, driver_name, truck_number, gate_out_driver_name, gate_out_truck_number, odometer_in, odometer_out, key_count, created_by, gated_out_by, vehicles(vin, model, model_year, color), manufacturers(code, name), yards(name)",
    )
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!visit) throw new Error("Car not found, or you may not see it.");
  if (kind === "gate_out" && !visit.gate_out_time) throw new Error("This car has not been released yet.");

  const v = visit as unknown as {
    vehicles: { vin: string; model: string | null; model_year: number | null; color: string | null } | null;
    manufacturers: { code: string; name: string } | null;
    yards: { name: string } | null;
  };

  // The person who received (gate-in) or released (gate-out) the car, from the visit record.
  const operatorId = kind === "gate_in" ? visit.created_by : visit.gated_out_by;
  let operatorName: string | null = null;
  if (operatorId) {
    const { data: p } = await supabase.from("profiles").select("full_name, username").eq("user_id", operatorId).maybeSingle();
    operatorName = p?.full_name || p?.username || null;
  }

  let condition: TicketCondition | null = null;
  if (kind === "gate_in") {
    const { data: insp } = await supabase
      .from("vehicle_inspections")
      .select("id, odometer, fuel_level, keys_present, notes")
      .eq("visit_id", visitId).eq("phase", "gate_in").eq("status", "closed").maybeSingle();
    if (insp) {
      const { data: damage } = await supabase
        .from("vehicle_inspection_photos").select("note").eq("inspection_id", insp.id).eq("angle", "damage").order("created_at");
      condition = {
        odometer: insp.odometer, fuelLevel: insp.fuel_level, keysPresent: insp.keys_present, notes: insp.notes,
        damageNotes: (damage ?? []).map((d) => d.note?.trim() || "Damage (no note)"),
      };
    }
  }

  return {
    kind,
    ticketNumber: visit.ticket_number,
    yardName: v.yards?.name ?? "",
    manufacturerName: v.manufacturers?.name ?? "",
    manufacturerCode: v.manufacturers?.code ?? "",
    vin: v.vehicles?.vin ?? "",
    model: v.vehicles?.model ?? null,
    modelYear: v.vehicles?.model_year ?? null,
    color: v.vehicles?.color ?? null,
    gateInTime: visit.gate_in_time,
    gateOutTime: visit.gate_out_time,
    lotZone: visit.lot_zone,
    lotSlot: visit.lot_slot,
    driverName: visit.driver_name,
    truckNumber: visit.truck_number,
    gateOutDriverName: visit.gate_out_driver_name,
    gateOutTruckNumber: visit.gate_out_truck_number,
    odometerIn: visit.odometer_in,
    odometerOut: visit.odometer_out,
    keyCount: visit.key_count,
    daysStored: daysInLot(visit.gate_in_time, new Date(), visit.gate_out_time),
    operatorName,
    condition,
  };
}
