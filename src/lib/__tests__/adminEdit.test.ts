import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { adminEditContainer, describeChange, diffEdits, toLocalInput, toRpcChanges } = await import("../adminEdit");

describe("diffEdits", () => {
  it("returns only the fields that changed, with the new value", () => {
    const original = { shipping_line: "SLD", container_type: "20GP", driver_name: "ALI" };
    const edited = { shipping_line: "WOM", container_type: "20GP", driver_name: "ALI" };
    expect(diffEdits(original, edited)).toEqual({ shipping_line: "WOM" });
  });

  it("ignores surrounding spaces and treats blank as no value", () => {
    expect(diffEdits({ driver_name: "ALI" }, { driver_name: "  ALI " })).toEqual({});
    expect(diffEdits({ seal_number: null }, { seal_number: "" })).toEqual({});
    expect(diffEdits({ seal_number: "S1" }, { seal_number: " " })).toEqual({ seal_number: null });
  });

  it("compares numbers by value, whether typed as text or number", () => {
    expect(diffEdits({ fees: 12.5 }, { fees: "12.50" })).toEqual({});
    expect(diffEdits({ fees: 12.5 }, { fees: "15" })).toEqual({ fees: "15" });
    expect(diffEdits({ total_containers: 3 }, { total_containers: 2 })).toEqual({ total_containers: 2 });
  });
});

describe("time fields", () => {
  it("shows a Date as local datetime-local text", () => {
    expect(toLocalInput(new Date(2026, 8, 27, 9, 5))).toBe("2026-09-27T09:05");
    expect(toLocalInput(undefined)).toBe("");
  });

  it("sends local times to the RPC as ISO instants and leaves other fields alone", () => {
    const out = toRpcChanges({ gate_in_time: "2026-09-27T09:05", shipping_line: "WOM" });
    expect(out.gate_in_time).toBe(new Date(2026, 8, 27, 9, 5).toISOString());
    expect(out.shipping_line).toBe("WOM");
  });
});

describe("describeChange", () => {
  it("reads as label: old → new", () => {
    expect(describeChange({ field: "shipping_line", from: "SLD", to: "WOM" })).toBe("Shipping line: SLD → WOM");
    expect(describeChange({ field: "seal_number", from: null, to: "S1" })).toBe("Seal: — → S1");
    expect(describeChange({ field: "gate_out_driver_name", from: "SAMI", to: "SAMIR" })).toBe(
      "Gate-out driver: SAMI → SAMIR",
    );
  });

  it("formats logged timestamps as dates", () => {
    const text = describeChange({
      field: "gate_in_time",
      from: new Date(2026, 8, 27, 9, 5).toISOString(),
      to: new Date(2026, 8, 27, 10, 0).toISOString(),
    });
    expect(text).toBe("Gate-in time: 27/09/2026 09:05 → 27/09/2026 10:00");
  });
});

describe("adminEditContainer", () => {
  it("calls the RPC with the visit, the changes and the trimmed reason", async () => {
    rpc.mockResolvedValueOnce({ data: [{ field: "shipping_line", from: "SLD", to: "WOM" }], error: null });
    const res = await adminEditContainer("visit-1", { shipping_line: "WOM" }, "  wrong line  ");
    expect(rpc).toHaveBeenCalledWith("admin_edit_container", {
      _visit_id: "visit-1",
      _changes: { shipping_line: "WOM" },
      _reason: "wrong line",
    });
    expect(res).toEqual({ ok: true, changes: [{ field: "shipping_line", from: "SLD", to: "WOM" }] });
  });

  it("passes the database's message through on failure", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Only a yard admin can edit container records." } });
    const res = await adminEditContainer("visit-1", { shipping_line: "WOM" }, "x x");
    expect(res).toEqual({ ok: false, changes: [], error: "Only a yard admin can edit container records." });
  });
});
