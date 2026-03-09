import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import Booking from "./pages/Booking";
import AlbumDetail from "./pages/AlbumDetail";
import BookingModify from "./pages/BookingModify";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import MobileCapture from "./pages/MobileCapture";
import InvoiceView from "./pages/InvoiceView";
import TenantBookingPage from "./pages/TenantBookingPage";
import TenantSetup from "./pages/TenantSetup";
import TenantAdmin from "./pages/TenantAdmin";
import LoginPage from "./pages/LoginPage";
import { isSetupComplete, isLoggedIn } from "./lib/storage";
import { syncFromServer, getTenantByDomain } from "./lib/api";
import { CustomDomainContext } from "./lib/custom-domain-context";

const queryClient = new QueryClient();

function AdminGuard() {
  const [, rerender] = useState(0);
  const refresh = useCallback(() => rerender((n) => n + 1), []);

  if (!isSetupComplete()) {
    return <Setup onComplete={refresh} />;
  }
  if (!isLoggedIn()) {
    return <Login onLogin={refresh} />;
  }
  return <Admin />;
}

const App = () => {
  const [ready, setReady] = useState(false);
  const [customDomainSlug, setCustomDomainSlug] = useState<string | null>(null);

  useEffect(() => {
    const hostname = window.location.hostname;
    // Skip domain resolution for localhost / loopback / private IP access
    const isLocalAccess =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

    const tasks: Promise<unknown>[] = [syncFromServer()];
    if (!isLocalAccess) {
      tasks.push(
        getTenantByDomain(hostname).then((result) => {
          if (result?.slug) setCustomDomainSlug(result.slug);
        })
      );
    }
    Promise.allSettled(tasks).finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <CustomDomainContext.Provider value={customDomainSlug}>
          <BrowserRouter>
            <Routes>
              {/* When the app is served from a tenant's custom domain, show their booking page at root */}
              <Route
                path="/"
                element={customDomainSlug ? <TenantBookingPage overrideSlug={customDomainSlug} /> : <Booking />}
              />
              <Route path="/book/:tenantSlug" element={<TenantBookingPage />} />
              <Route path="/gallery/:albumId" element={<AlbumDetail />} />
              <Route path="/booking/modify/:bookingId" element={<BookingModify />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/capture" element={<MobileCapture />} />
              <Route path="/admin" element={<AdminGuard />} />
              <Route path="/admin/:tab" element={<AdminGuard />} />
              <Route path="/admin/storage" element={<AdminGuard />} />
              <Route path="/invoice/:token" element={<InvoiceView />} />
              <Route path="/tenant-setup/:token" element={<TenantSetup />} />
              <Route path="/tenant-admin/:slug" element={<TenantAdmin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </CustomDomainContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
