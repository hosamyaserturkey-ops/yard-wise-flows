import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./components/ThemeProvider";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

// Route-level code splitting: each page ships in its own chunk and loads on
// demand, keeping the initial bundle small. The Suspense boundary lives in
// Layout so the sidebar/top bar stay visible while a page chunk loads.
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const GateIn = lazy(() => import("./pages/GateIn"));
const GateOut = lazy(() => import("./pages/GateOut"));
const Reports = lazy(() => import("./pages/Reports"));
const Bookings = lazy(() => import("./pages/Bookings"));
const BookingDetail = lazy(() => import("./pages/BookingDetail"));
const PortDemurrageData = lazy(() => import("./pages/PortDemurrageData"));
const Accounting = lazy(() => import("./pages/Accounting"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const Yards = lazy(() => import("./pages/Yards"));
const Inspector = lazy(() => import("./pages/Inspector"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const YardMap = lazy(() => import("./pages/YardMap"));
const PhotoArchive = lazy(() => import("./pages/PhotoArchive"));
const Account = lazy(() => import("./pages/Account"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense
              fallback={
                <div className="flex min-h-dvh items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
                </div>
              }
            >
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
                  <ProtectedRoute lineRepAllowed>
                    <Reports />
                  </ProtectedRoute>
                } />
                <Route path="bookings" element={
                  <ProtectedRoute lineRepAllowed>
                    <Bookings />
                  </ProtectedRoute>
                } />
                <Route path="port-data" element={
                  <ProtectedRoute adminOnly lineRepAllowed>
                    <PortDemurrageData />
                  </ProtectedRoute>
                } />
                <Route path="accounting" element={
                  <ProtectedRoute adminOnly>
                    <Accounting />
                  </ProtectedRoute>
                } />
                {/* Everyone manages their own password here, line reps included. */}
                <Route path="account" element={
                  <ProtectedRoute lineRepAllowed>
                    <Account />
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
                  <ProtectedRoute lineRepAllowed>
                    <BookingDetail />
                  </ProtectedRoute>
                } />
                <Route path="inspector" element={
                  <ProtectedRoute>
                    <Inspector />
                  </ProtectedRoute>
                } />
                <Route path="activity" element={
                  <ProtectedRoute adminOnly>
                    <ActivityLog />
                  </ProtectedRoute>
                } />
                <Route path="yard-map" element={
                  <ProtectedRoute>
                    <YardMap />
                  </ProtectedRoute>
                } />
                <Route path="photos" element={
                  <ProtectedRoute>
                    <PhotoArchive />
                  </ProtectedRoute>
                } />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
