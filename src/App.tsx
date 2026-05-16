import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import GateIn from "./pages/GateIn";
import GateOut from "./pages/GateOut";
import Reports from "./pages/Reports";
import ImportContainers from "./pages/ImportContainers";
import Bookings from "./pages/Bookings";
import BookingDetail from "./pages/BookingDetail";
import PortDemurrageData from "./pages/PortDemurrageData";
import Accounting from "./pages/Accounting";
import UserManagement from "./pages/UserManagement";
import Yards from "./pages/Yards";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<Layout />}>
              <Route index element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } />
              <Route path="gate-in" element={
                <ProtectedRoute>
                  <GateIn />
                </ProtectedRoute>
              } />
              <Route path="gate-out" element={
                <ProtectedRoute>
                  <GateOut />
                </ProtectedRoute>
              } />
              <Route path="reports" element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              } />
              <Route path="import" element={
                <ProtectedRoute adminOnly>
                  <ImportContainers />
                </ProtectedRoute>
              } />
              <Route path="bookings" element={
                <ProtectedRoute>
                  <Bookings />
                </ProtectedRoute>
              } />
              <Route path="port-data" element={
                <ProtectedRoute adminOnly>
                  <PortDemurrageData />
                </ProtectedRoute>
              } />
              <Route path="accounting" element={
                <ProtectedRoute adminOnly>
                  <Accounting />
                </ProtectedRoute>
              } />
              <Route path="admin/users" element={
                <ProtectedRoute adminOnly>
                  <UserManagement />
                </ProtectedRoute>
              } />
              <Route path="admin/yards" element={
                <ProtectedRoute superAdminOnly>
                  <Yards />
                </ProtectedRoute>
              } />
              <Route path="bookings/:bookingId" element={
                <ProtectedRoute>
                  <BookingDetail />
                </ProtectedRoute>
              } />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
