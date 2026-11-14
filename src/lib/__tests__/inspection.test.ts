import { describe, expect, it } from "vitest";
import { REQUIRED_SHOTS, SHOTS, closeBlocker, damagePhotos, isPhase, latestByAngle, missingShots, parseKm } from "../inspection";

const photo = (id: string, angle: string, at: string) => ({ id, angle, created_at: at });
const all = () => REQUIRED_SHOTS.map((s, i) => photo(`p${i}`, s.id, `2026-11-10T10:${String(i).padStart(2, "0")}:00Z`));

describe("shot list", () => {
  it("has unique ids that fit the Worker's angle rule, and never uses 'damage'", () => {
    const ids = SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(ids).not.toContain("damage");
  });
  it("requires the eight views round the car, the dashboard and the interior", () => {
    expect(REQUIRED_SHOTS.map((s) => s.id)).toEqual([
      "front", "front_right", "right", "rear_right", "rear", "rear_left", "left", "front_left", "dashboard", "interior",
    ]);
  });
});

describe("latestByAngle", () => {
  it("keeps the newest photo of an angle (a retake)", () => {
    const m = latestByAngle([photo("a", "front", "2026-11-10T10:00:00Z"), photo("b", "front", "2026-11-10T10:05:00Z")]);
    expect(m.get("front")?.id).toBe("b");
  });
  it("leaves damage photos out", () => {
    expect(latestByAngle([photo("a", "damage", "2026-11-10T10:00:00Z")]).size).toBe(0);
  });
});

describe("damagePhotos", () => {
  it("lists only damage photos, oldest first", () => {
    const list = damagePhotos([photo("b", "damage", "2026-11-10T10:05:00Z"), photo("x", "front", "2026-11-10T10:01:00Z"), photo("a", "damage", "2026-11-10T10:00:00Z")]);
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("missingShots / closeBlocker", () => {
  it("lists the required shots still missing", () => {
    expect(missingShots([]).length).toBe(REQUIRED_SHOTS.length);
    expect(missingShots(all().slice(2)).map((s) => s.id)).toEqual(["front", "front_right"]);
  });
  it("allows closing only when every required shot has a photo", () => {
    expect(closeBlocker(all())).toBeNull();
    expect(closeBlocker(all().slice(0, 9))).toMatch(/Interior/);
  });
  it("does not need the optional shots or any damage photo", () => {
    expect(closeBlocker(all())).toBeNull();
  });
  it("shortens a long list", () => {
    expect(closeBlocker([])).toMatch(/and 7 more/);
  });
  it("blocks while a photo is uploading", () => {
    expect(closeBlocker(all(), true)).toMatch(/uploading/);
  });
});

describe("parseKm", () => {
  it("reads whole numbers, empty as null, anything else as undefined", () => {
    expect(parseKm("12500")).toBe(12500);
    expect(parseKm(" ")).toBeNull();
    expect(parseKm("12.5")).toBeUndefined();
    expect(parseKm("-3")).toBeUndefined();
    expect(parseKm("12345678")).toBeUndefined();
  });
});

describe("isPhase", () => {
  it("accepts the two phases only", () => {
    expect(isPhase("gate_in")).toBe(true);
    expect(isPhase("gate_out")).toBe(true);
    expect(isPhase("other")).toBe(false);
    expect(isPhase(undefined)).toBe(false);
  });
});
