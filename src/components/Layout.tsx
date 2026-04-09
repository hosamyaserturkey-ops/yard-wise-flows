import { ReactNode } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { Container, Ship, FileText, BarChart3, LogIn, LogOut, Crown, Upload, Calendar, Anchor, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const Layout = () => {
  const location = useLocation();
  const { user, profile, signOut } = useAuth();

  const navigationItems = [
    { href: "/", label: "Dashboard", icon: BarChart3 },
    { href: "/gate-in", label: "Gate In", icon: Container },
    { href: "/gate-out", label: "Gate Out", icon: Ship },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/import", label: "Import", icon: Upload },
    { href: "/port-data", label: "Port Data", icon: Anchor },
    { href: "/bookings", label: "Bookings", icon: Calendar },
    { href: "/accounting", label: "Accounting", icon: Calculator },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card shadow-sm">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-2">
              <Container className="h-8 w-8 text-maritime" />
              <h1 className="text-xl font-bold text-industrial">Container Yard Management</h1>
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
                        "flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-maritime text-maritime-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              {user && (
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {profile?.full_name || user.email}
                    </span>
                    {profile?.role === 'admin' && (
                      <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/20">
                        <Crown className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={signOut}
                    className="border-maritime text-maritime hover:bg-maritime hover:text-white"
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