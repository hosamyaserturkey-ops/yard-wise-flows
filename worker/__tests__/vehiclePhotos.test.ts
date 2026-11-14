import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../index";
import {
  MAX_VEHICLE_PHOTO_BYTES, checkVehiclePhoto, isVehicleSideProfile, photoExtension, photoKey, sha256Hex,
} from "../vehiclePhotos";

describe("checkVehiclePhoto", () => {
  it("accepts the types phones and browsers send", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/jpeg; charset=binary"]) {
      expect(checkVehiclePhoto(t, 1000), t).toBeNull();
    }
  });
  it("rejects other types, empty files and files over 5 MB", () => {
    expect(checkVehiclePhoto("application/pdf", 1000)).toMatch(/JPEG/);
    expect(checkVehiclePhoto("text/html", 1000)).toMatch(/JPEG/);
    expect(checkVehiclePhoto("image/jpeg", 0)).toMatch(/empty/);
    expect(checkVehiclePhoto("image/jpeg", MAX_VEHICLE_PHOTO_BYTES + 1)).toMatch(/5 MB/);
    expect(checkVehiclePhoto("image/jpeg", MAX_VEHICLE_PHOTO_BYTES)).toBeNull();
  });
});

describe("photoKey / photoExtension", () => {
  it("builds the key under the folder Postgres returned, with a random name", () => {
    expect(photoKey("m/v/i/", "abc", "webp")).toBe("m/v/i/abc.webp");
  });
  it("maps content types to extensions", () => {
    expect(photoExtension("image/heif")).toBe("heic");
    expect(photoExtension("image/png; x=y")).toBe("png");
  });
});

describe("sha256Hex", () => {
  it("hashes the bytes", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Hex(bytes)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("isVehicleSideProfile", () => {
  it("is true for a manufacturer login and for car-lot staff", () => {
    expect(isVehicleSideProfile({ manufacturer_id: "m", yards: null })).toBe(true);
    expect(isVehicleSideProfile({ manufacturer_id: null, yards: { kind: "vehicle" } })).toBe(true);
  });
  it("is false for container staff and for no profile", () => {
    expect(isVehicleSideProfile({ manufacturer_id: null, yards: { kind: "container" } })).toBe(false);
    expect(isVehicleSideProfile(null)).toBe(false);
  });
});

// ── routes ──────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

const INSPECTION = "f1000000-0000-0000-0000-0000000000a1";
const PHOTO = "aa000000-0000-0000-0000-0000000000b1";
const PREFIX = "m1/v1/f1000000-0000-0000-0000-0000000000a1/";

function fakeBucket() {
  const store = new Map<string, { bytes: ArrayBuffer; type: string }>();
  return {
    store,
    put: vi.fn(async (key: string, value: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { bytes: value, type: o?.httpMetadata?.contentType ?? "" });
    }),
    get: vi.fn(async (key: string) => {
      const o = store.get(key);
      return o ? { body: new Response(o.bytes).body!, httpMetadata: { contentType: o.type } } : null;
    }),
    delete: vi.fn(async (keys: string | string[]) => { for (const k of [keys].flat()) store.delete(k); }),
  };
}
const env = (over: Partial<Env> = {}): Env & { VEHICLE_PHOTOS_BUCKET: ReturnType<typeof fakeBucket> } =>
  ({ SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", VEHICLE_PHOTOS_BUCKET: fakeBucket(), PHOTOS_BUCKET: fakeBucket(), ...over }) as never;

function stubSupabase(opts: { prefix?: Response; insert?: Response; row?: unknown[] } = {}) {
  const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body as string | undefined });
    if (url.includes("/rpc/vehicle_photo_upload_prefix")) return opts.prefix ?? new Response(JSON.stringify(PREFIX), { status: 200 });
    if (url.includes("/rest/v1/vehicle_inspection_photos") && init?.method === "POST") {
      return opts.insert ?? new Response(JSON.stringify([{ id: PHOTO }]), { status: 201 });
    }
    if (url.includes("/rest/v1/vehicle_inspection_photos")) return new Response(JSON.stringify(opts.row ?? []), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return seen;
}

const jpeg = (size = 2000) => new Uint8Array(size).fill(7);
const upload = (e: Env, query = `inspection=${INSPECTION}&angle=front`, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://yard.test/api/vehicle-photos/upload?${query}`, {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "image/jpeg" },
    body: jpeg(),
    ...init,
  }), e);

describe("POST /api/vehicle-photos/upload", () => {
  it("asks Postgres as the user, stores under the folder it returned, then records the photo", async () => {
    const seen = stubSupabase();
    const e = env();
    const res = await upload(e);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(PHOTO);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const [key] = [...e.VEHICLE_PHOTOS_BUCKET.store.keys()];
    expect(key.startsWith(PREFIX)).toBe(true);
    expect(key.endsWith(".jpg")).toBe(true);
    // every Supabase call carries the caller's own login, never a service key
    for (const call of seen) expect(call.headers.authorization).toBe("Bearer jwt");
    const insert = JSON.parse(seen.find((c) => c.body && c.url.endsWith("/vehicle_inspection_photos"))!.body!);
    expect(insert).toMatchObject({ inspection_id: INSPECTION, angle: "front", storage_path: key });
    expect(insert.file_sha256).toBe(body.sha256);
  });

  it("stores nothing when Postgres refuses the user", async () => {
    stubSupabase({ prefix: new Response(JSON.stringify({ message: "not allowed to add photos to this inspection" }), { status: 403 }) });
    const e = env();
    const res = await upload(e);
    expect(res.status).toBe(403);
    expect(e.VEHICLE_PHOTOS_BUCKET.put).not.toHaveBeenCalled();
  });

  it("says the inspection is closed (409) and stores nothing", async () => {
    stubSupabase({ prefix: new Response(JSON.stringify({ message: "inspection is closed" }), { status: 403 }) });
    const e = env();
    const res = await upload(e);
    expect(res.status).toBe(409);
    expect(e.VEHICLE_PHOTOS_BUCKET.put).not.toHaveBeenCalled();
  });

  it("removes the file again when recording the photo fails", async () => {
    stubSupabase({ insert: new Response(JSON.stringify({ message: "inspection is closed" }), { status: 400 }) });
    const e = env();
    const res = await upload(e);
    expect(res.status).toBe(409);
    expect(e.VEHICLE_PHOTOS_BUCKET.delete).toHaveBeenCalledTimes(1);
    expect(e.VEHICLE_PHOTOS_BUCKET.store.size).toBe(0);
  });

  it("rejects bad input before calling Supabase", async () => {
    const seen = stubSupabase();
    const e = env();
    expect((await upload(e, `inspection=nope&angle=front`)).status).toBe(400);
    expect((await upload(e, `inspection=${INSPECTION}&angle=Front Left`)).status).toBe(400);
    expect((await upload(e, `inspection=${INSPECTION}&angle=front`, { headers: { Authorization: "Bearer jwt", "Content-Type": "application/pdf" } })).status).toBe(415);
    expect((await upload(e, `inspection=${INSPECTION}&angle=front`, { body: jpeg(MAX_VEHICLE_PHOTO_BYTES + 1) })).status).toBe(413);
    expect((await upload(e, `inspection=${INSPECTION}&angle=front`, { headers: { "Content-Type": "image/jpeg" } })).status).toBe(401);
    expect(seen).toHaveLength(0);
  });
});

describe("GET /api/vehicle-photos/view", () => {
  const view = (e: Env, id = PHOTO) =>
    worker.fetch(new Request(`https://yard.test/api/vehicle-photos/view?id=${id}`, { headers: { Authorization: "Bearer jwt" } }), e);

  it("streams the file only when the user can read the photo row", async () => {
    const e = env();
    e.VEHICLE_PHOTOS_BUCKET.store.set("m1/v1/i1/x.jpg", { bytes: jpeg(10).buffer as ArrayBuffer, type: "image/jpeg" });
    stubSupabase({ row: [{ storage_path: "m1/v1/i1/x.jpg" }] });
    const res = await view(e);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it("answers 404 and never touches the bucket when row-level security returns no row", async () => {
    const e = env();
    stubSupabase({ row: [] });
    expect((await view(e)).status).toBe(404);
    expect(e.VEHICLE_PHOTOS_BUCKET.get).not.toHaveBeenCalled();
  });

  it("takes a photo row id, never an object key", async () => {
    const e = env();
    stubSupabase();
    expect((await view(e, "m1/v1/i1/x.jpg")).status).toBe(400);
  });

  it("has no delete route", async () => {
    stubSupabase();
    const res = await worker.fetch(new Request("https://yard.test/api/vehicle-photos/delete", { method: "POST", headers: { Authorization: "Bearer jwt" } }), env());
    expect(res.status).toBe(404);
  });
});

// The container photo routes must refuse car-lot and manufacturer users.
describe("container photo routes and the car lot", () => {
  function stubContainerAuth(roles: string[], profile: unknown[]) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.includes("/rest/v1/user_roles")) return new Response(JSON.stringify(roles.map((role) => ({ role }))), { status: 200 });
      if (url.includes("/rest/v1/profiles")) return new Response(JSON.stringify(profile), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  }
  const containerView = (e: Env) =>
    worker.fetch(new Request("https://yard.test/api/photos/view?key=u1/a.webp", { headers: { Authorization: "Bearer jwt" } }), e);

  it("lets container staff through", async () => {
    const e = env();
    e.PHOTOS_BUCKET.put("u1/a.webp", new ArrayBuffer(3));
    stubContainerAuth(["inspector"], [{ manufacturer_id: null, yards: { kind: "container" } }]);
    expect((await containerView(e)).status).toBe(200);
  });

  it("refuses a car-lot inspector who holds the same role name", async () => {
    stubContainerAuth(["inspector"], [{ manufacturer_id: null, yards: { kind: "vehicle" } }]);
    expect((await containerView(env())).status).toBe(403);
  });

  it("refuses a manufacturer login", async () => {
    stubContainerAuth(["user"], [{ manufacturer_id: "m1", yards: null }]);
    expect((await containerView(env())).status).toBe(403);
  });

  it("refuses when the profile cannot be read", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.includes("/rest/v1/user_roles")) return new Response(JSON.stringify([{ role: "inspector" }]), { status: 200 });
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    expect((await containerView(env())).status).toBe(403);
  });

  it("does not ask the owner (super admin) to pass the profile check", async () => {
    const e = env();
    e.PHOTOS_BUCKET.put("u1/a.webp", new ArrayBuffer(3));
    stubContainerAuth(["super_admin"], [{ manufacturer_id: null, yards: { kind: "vehicle" } }]);
    expect((await containerView(e)).status).toBe(200);
  });
});
