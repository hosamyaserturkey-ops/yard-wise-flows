import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";

/** The manufacturer portal is for manufacturer logins only; staff go back to the app. */
const PortalRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isManufacturerRep, loading } = useAuth();
  if (loading) return <AppLoading fullScreen />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isManufacturerRep()) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default PortalRoute;
