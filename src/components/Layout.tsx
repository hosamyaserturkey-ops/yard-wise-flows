import { Link, useLocation, Outlet } from "react-router-dom";
import { Container, Ship, FileText, BarChart3, LogOut, Crown, Upload, Calendar, Anchor, Calculator, Users, Building2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const Layout = () => {
  const location = useLocation();
  const { user, profile, signOut, isAdmin, isSuperAdmin } = useAuth();
  const admin = isAdmin();
  const superAdmin = isSuperAdmin();

  const baseItems = [
    { href: "/", label: "Dashboard", icon: BarChart3, adminOnly: false, superOnly: false },
    { href: "/gate-in", label: "Gate In", icon: Container, adminOnly: false, superOnly: false },
    { href: "/gate-out", label: "Gate Out", icon: Ship, adminOnly: false, superOnly: false },
    { href: "/reports", label: "Reports", icon: FileText, adminOnly: false, superOnly: false },
    { href: "/bookings", label: "Bookings", icon: Calendar, adminOnly: false, superOnly: false },
    { href: "/import", label: "Import", icon: Upload, adminOnly: true, superOnly: false },
    { href: "/port-data", label: "Port Data", icon: Anchor, adminOnly: true, superOnly: false },
    { href: "/accounting", label: "Accounting", icon: Calculator, adminOnly: true, superOnly: false },
    { href: "/admin/users", label: "Users", icon: Users, adminOnly: true, superOnly: false },
    { href: "/admin/yards", label: "Yards", icon: Building2, adminOnly: false, superOnly: true },
  ];
  const navigationItems = baseItems.filter((i) => {
    if (i.superOnly) return superAdmin;
    if (i.adminOnly) return admin;
    // Hide operator nav items from super_admin (they have no yard context)
    return !superAdmin;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 bg-black/30 backdrop-blur-md">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-2">
              <Container className="h-8 w-8 text-white drop-shadow-md" />
              <h1 className="text-xl font-bold text-white drop-shadow-md">Container Yard Management</h1>
            </div>
            
            <div className="flex items-center space-x-6">
              <nav className="flex space-x-1">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        "flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors drop-shadow-md",
                        isActive
                          ? "bg-maritime/80 text-white backdrop-blur-sm shadow-sm"
                          : item.adminOnly
                            ? "text-warning hover:text-warning hover:bg-warning/20"
                            : "text-white/90 hover:text-white hover:bg-white/15"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {item.adminOnly && !isActive && (
                        <Crown className="h-3 w-3 opacity-70" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              {user && (
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-white drop-shadow-sm">
                      {profile?.full_name || user.email}
                    </span>
                    <span className="text-xs text-white/70 drop-shadow-sm">
                      {superAdmin ? "Super Admin" : profile?.yard_name ? `Yard: ${profile.yard_name}` : "No yard"}
                    </span>
                  </div>
                  {superAdmin && (
                    <Badge variant="secondary" className="bg-warning/30 text-white border-warning/40 backdrop-blur-sm">
                      <ShieldCheck className="h-3 w-3 mr-1" /> Super
                    </Badge>
                  )}
                  {!superAdmin && profile?.role === 'admin' && (
                    <Badge variant="secondary" className="bg-warning/20 text-warning border-warning/30 backdrop-blur-sm">
                      <Crown className="h-3 w-3 mr-1" /> Admin
                    </Badge>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={signOut}
                    className="border-white/40 text-white bg-white/10 backdrop-blur-sm hover:bg-white/20 hover:text-white"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;