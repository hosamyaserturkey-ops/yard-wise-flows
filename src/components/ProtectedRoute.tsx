import { Navigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { toast } from "sonner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  /** Allow shipping-line representatives onto this route (they are otherwise
   *  confined to the routes that carry this flag and redirected to /reports). */
  lineRepAllowed?: boolean;
}

const ProtectedRoute = ({ children, adminOnly = false, superAdminOnly = false, lineRepAllowed = false }: ProtectedRouteProps) => {
  const { user, isAdmin, isSuperAdmin, isLineRep, loading } = useAuth();
  const notified = useRef(false);

  const lineRep = !loading && !!user && isLineRep();
  const denied =
    !loading && user &&
    ((superAdminOnly && !isSuperAdmin()) ||
      (adminOnly && !isAdmin() && !(lineRepAllowed && lineRep)));

  useEffect(() => {
    if (denied && !notified.current) {
      notified.current = true;
      toast.error("Admin access required", {
        description: "You don't have permission to view this page.",
      });
    }
  }, [denied]);

  // The sidebar and top bar are already on screen; this fills the page area
  // for the one round trip that loads the profile and roles.
  if (loading) {
    return <AppLoading label="Loading your workspace…" />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (denied) {
    return <Navigate to={lineRep ? "/reports" : "/"} replace />;
  }

  // Line reps only get the routes explicitly flagged for them.
  if (lineRep && !lineRepAllowed) {
    return <Navigate to="/reports" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
