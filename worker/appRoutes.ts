// Which URLs are pages of the app. With `not_found_handling: "none"` (see
// wrangler.jsonc) every request that isn't a file in dist/ reaches the Worker,
// which answers a page-like path with the app shell: 200 for the routes below,
// 404 for anything else, so a mistyped or stale link is a real 404 to
// browsers, crawlers and uptime checks while the app still shows its Not Found
// page. Keep this in step with the <Route> paths in src/App.tsx; a test fails
// when the two disagree.
export const APP_ROUTES: readonly (string | RegExp)[] = [
  "/",
  "/auth",
  "/gate-in",
  "/gate-out",
  "/reports",
  "/bookings",
  /^\/bookings\/[^/]+$/,
  "/port-data",
  "/accounting",
  "/cash-count",
  "/statement",
  "/account",
  "/admin/users",
  "/admin/yards",
  "/inspector",
  "/activity",
  "/yard-map",
  "/photos",
  "/terminal-check",
];

export function isAppRoute(pathname: string): boolean {
  // React Router treats /gate-in/ like /gate-in.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return APP_ROUTES.some((route) => (typeof route === "string" ? route === path : route.test(path)));
}

/** A browser asking for a page, as opposed to a file such as /assets/x.js. */
export function isPageRequest(req: Request, url: URL): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const lastSegment = url.pathname.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}
