import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, { type Env } from "../index";
import { APP_ROUTES, isAppRoute } from "../appRoutes";

// Every <Route path="..."> in App.tsx, made absolute (children of the "/"
// layout route are written relative to it).
function appTsxPaths(): string[] {
  const src = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf8");
  return [...src.matchAll(/<Route\s+(?:index\s+)?path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== "*")
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
}

describe("APP_ROUTES", () => {
  it("covers every route in App.tsx", () => {
    const paths = appTsxPaths();
    expect(paths.length).toBeGreaterThan(15); // the pattern still finds them
    for (const path of paths) {
      expect(isAppRoute(path.replace(/:[^/]+/g, "some-id")), path).toBe(true);
    }
  });

  it("lists nothing App.tsx doesn't have", () => {
    const paths = appTsxPaths();
    for (const route of APP_ROUTES) {
      if (typeof route === "string") expect(paths, route).toContain(route);
    }
  });

  it("matches with or without a trailing slash, and nothing else", () => {
    expect(isAppRoute("/gate-in/")).toBe(true);
    expect(isAppRoute("/bookings/3f1c")).toBe(true);
    expect(isAppRoute("/bookings/3f1c/extra")).toBe(false);
    expect(isAppRoute("/gate-inn")).toBe(false);
    expect(isAppRoute("/wp-admin")).toBe(false);
  });
});

// A stand-in for the static-assets binding: serves a few files, 404 otherwise.
const FILES: Record<string, { body: string; type: string }> = {
  "/": { body: "<!doctype html><title>app</title>", type: "text/html" },
  "/robots.txt": { body: "User-agent: *", type: "text/plain" },
  "/assets/index-abc.js": { body: "console.log(1)", type: "text/javascript" },
};
const env = {
  ASSETS: {
    fetch: async (req: Request) => {
      const file = FILES[new URL(req.url).pathname];
      return file
        ? new Response(file.body, { status: 200, headers: { "Content-Type": file.type, ETag: '"e1"' } })
        : new Response("Not found", { status: 404 });
    },
  },
} as unknown as Env;
const get = (path: string, method = "GET") => worker.fetch(new Request(`https://yard.test${path}`, { method }), env);

describe("Worker routing for pages and files", () => {
  it("serves files as they are", async () => {
    const res = await get("/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *");
  });

  it("answers an app route with the app and a 200", async () => {
    for (const path of ["/gate-in", "/gate-in/", "/bookings/3f1c", "/auth"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain("<title>app</title>");
    }
  });

  it("answers an unknown page with the app, a 404 and noindex", async () => {
    const res = await get("/no-such-page");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("ETag")).toBeNull();
    expect(await res.text()).toContain("<title>app</title>");
  });

  it("lets a missing file stay a plain 404 instead of returning HTML", async () => {
    const res = await get("/assets/index-old.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("Not found");
  });

  it("answers an unknown API path with a JSON 404", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("doesn't serve the app for other methods", async () => {
    const res = await get("/no-such-page", "POST");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
