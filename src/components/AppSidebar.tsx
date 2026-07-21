import { Link, useLocation } from "react-router-dom";
import {
  BarChart3, Container, Ship, FileText, Calendar, Upload, Anchor,
  Calculator, Users, Building2, ClipboardCheck, LogOut, ShieldCheck, Crown,
  MapPin, Camera, Activity,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarSeparator,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ModeToggle } from "@/components/ModeToggle";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const OPS_NAV = [
  { href: "/",           label: "Dashboard",  icon: BarChart3    },
  { href: "/gate-in",    label: "Gate In",    icon: Container    },
  { href: "/gate-out",   label: "Gate Out",   icon: Ship         },
  { href: "/yard-map",   label: "Yard Map",   icon: MapPin       },
  { href: "/photos",     label: "Photos",     icon: Camera       },
  { href: "/reports",    label: "Reports",    icon: FileText     },
  { href: "/bookings",   label: "Bookings",   icon: Calendar     },
];

const ADMIN_NAV = [
  { href: "/import",     label: "Import",     icon: Upload       },
  { href: "/port-data",  label: "Port Data",  icon: Anchor       },
  { href: "/accounting", label: "Accounting", icon: Calculator   },
  { href: "/activity",   label: "Activity",   icon: Activity     },
  { href: "/admin/users",label: "Users",      icon: Users        },
  { href: "/inspector",  label: "Inspect",    icon: ClipboardCheck },
];

const SUPER_NAV = [
  { href: "/",           label: "Dashboard",  icon: BarChart3    },
  { href: "/reports",    label: "Reports",    icon: FileText     },
  { href: "/photos",     label: "Photos",     icon: Camera       },
  { href: "/port-data",  label: "Port Data",  icon: Anchor       },
  { href: "/activity",   label: "Activity",   icon: Activity     },
  { href: "/admin/yards",label: "Yards",      icon: Building2    },
  { href: "/inspector",  label: "Inspect",    icon: ClipboardCheck },
];

const INSPECTOR_ONLY = [
  { href: "/inspector",  label: "Inspect",    icon: ClipboardCheck },
  { href: "/photos",     label: "Photos",     icon: Camera       },
];

const LINE_REP_NAV = [
  { href: "/reports",    label: "My Containers", icon: FileText },
  { href: "/port-data",  label: "Port Data",     icon: Anchor   },
];

export function AppSidebar() {
  const location = useLocation();
  const { profile, signOut, isAdmin, isSuperAdmin, isInspector, isLineRep } = useAuth();

  const admin      = isAdmin();
  const superAdmin = isSuperAdmin();
  const inspector  = isInspector();
  const lineRep    = isLineRep();

  const isActive = (href: string) =>
    href === "/" ? location.pathname === "/" : location.pathname.startsWith(href);

  const NavItem = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) => (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(href)} tooltip={label}>
        <Link to={href} className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const initials = (profile?.full_name || profile?.username || "?")
    .split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* ── Header ─────────────────────────────────── */}
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-maritime text-white">
            <Container className="h-4 w-4" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
              Container Yard
            </p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {profile?.yard_name || "Management"}
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* ── Content ────────────────────────────────── */}
      <SidebarContent>

        {/* Line representative — only their line's data + port data entry */}
        {lineRep && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Ship className="h-3 w-3 mr-1 inline" />
              {profile?.shipping_line || "Shipping Line"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {LINE_REP_NAV.map((item) => (
                  <NavItem key={item.href} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Operations — visible to non-super, non-inspector users */}
        {!superAdmin && !inspector && !lineRep && (
          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {OPS_NAV.map((item) => (
                  <NavItem key={item.href} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Admin section */}
        {admin && !superAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Crown className="h-3 w-3 mr-1 text-warning inline" />
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <NavItem key={item.href} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Super Admin section */}
        {superAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <ShieldCheck className="h-3 w-3 mr-1 text-warning inline" />
              Super Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SUPER_NAV.map((item) => (
                  <NavItem key={item.href} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Inspector only */}
        {inspector && !admin && !superAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <ClipboardCheck className="h-3 w-3 mr-1 inline" />
              Inspector
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {INSPECTOR_ONLY.map((item) => (
                  <NavItem key={item.href} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

      </SidebarContent>

      {/* ── Footer ─────────────────────────────────── */}
      <SidebarFooter>
        <SidebarSeparator />
        <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="bg-maritime text-white text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">
              {profile?.full_name || profile?.username || "User"}
            </p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {superAdmin ? "Super Admin" : admin ? "Admin" : inspector ? "Inspector" : lineRep ? `${profile?.shipping_line || ""} Representative`.trim() : "Operator"}
            </p>
          </div>
          <div className="flex items-center gap-1 group-data-[collapsible=icon]:hidden">
            <ModeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={signOut}
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
