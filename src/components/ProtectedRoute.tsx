import { Navigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

const ProtectedRoute = ({ children, adminOnly = false, superAdminOnly = false }: ProtectedRouteProps) => {
  const { user, isAdmin, isSuperAdmin, loading } = useAuth();
  const notified = useRef(false);

  const denied = !loading && user && ((superAdminOnly && !isSuperAdmin()) || (adminOnly && !isAdmin()));

  useEffect(() => {
    if (denied && !notified.current) {
      notified.current = true;
      toast.error("Admin access required", {
        description: "You don't have permission to view this page.",
      });
    }
  }, [denied]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-maritime/10 to-industrial/10 p-6">
        <div className="space-y-6">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (denied) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
