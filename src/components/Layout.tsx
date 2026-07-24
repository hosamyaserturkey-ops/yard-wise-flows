import { Outlet, useLocation } from "react-router-dom";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { YardSwitcher } from "@/components/YardSwitcher";
import { Keyboard } from "lucide-react";

const ROUTE_LABELS: Record<string, string> = {
  "/":             "Dashboard",
  "/gate-in":      "Gate In",
  "/gate-out":     "Gate Out",
  "/reports":      "Reports",
  "/bookings":     "Bookings",
  "/port-data":    "Port Data",
  "/accounting":   "Accounting",
  "/admin/users":  "Users",
  "/admin/yards":  "Yards",
  "/inspector":    "Inspect",
};

const Layout = () => {
  const location = useLocation();
  const pageLabel =
    ROUTE_LABELS[location.pathname] ??
    ROUTE_LABELS[
      Object.keys(ROUTE_LABELS).find(
        (k) => k !== "/" && location.pathname.startsWith(k),
      ) ?? ""
    ] ??
    "Container Yard";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* ── Top Bar ─────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur-sm px-4 sticky top-0 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium text-foreground">{pageLabel}</span>
          <div className="flex-1" />
          <YardSwitcher />
          <ToggleCommandHint />
        </header>

        {/* ── Page Content ────────────────────────────── */}
        <main className="flex-1 overflow-auto bg-background">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </SidebarInset>

      {/* Command palette — always mounted so ⌘K works everywhere */}
      <CommandPalette />
    </SidebarProvider>
  );
};

/** Small ⌘K badge that fires the keyboard shortcut on click */
const ToggleCommandHint = () => {
  const fire = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  };

  return (
    <button
      onClick={fire}
      className="hidden sm:inline-flex items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
      aria-label="Open command palette"
    >
      <Keyboard className="h-3 w-3" />
      <span className="font-medium">⌘K</span>
    </button>
  );
};

export default Layout;
