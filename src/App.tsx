import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { isSetupComplete, isLoggedIn } from "./lib/storage";
import { syncFromServer, getTenantByDomain } from "./lib/api";
import { CustomDomainContext } from "./lib/custom-domain-context";

// Eagerly load the public-facing booking page so it renders with zero extra round-trips.
import TenantBookingPage from "./pages/TenantBookingPage";

// Lazily load everything else — these are only needed by admin / gallery users.
const Booking = lazy(() => import("./pages/Booking"));
const AlbumDetail = lazy(() => import("./pages/AlbumDetail"));
const BookingModify = lazy(() => import("./pages/BookingModify"));
const Admin = lazy(() => import("./pages/Admin"));
const Login = lazy(() => import("./pages/Login"));
const Setup = lazy(() => import("./pages/Setup"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MobileCapture = lazy(() => import("./pages/MobileCapture"));
const InvoiceView = lazy(() => import("./pages/InvoiceView"));
const TenantSetup = lazy(() => import("./pages/TenantSetup"));
const TenantAdmin = lazy(() => import("./pages/TenantAdmin"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

const queryClient = new QueryClient();

/** Routes that don't need the server sync before rendering */
function isPublicRoute(): boolean {
  const p = window.location.pathname;
  return (
    p.startsWith("/book/") ||
    p.startsWith("/gallery/") ||
    p.startsWith("/invoice/") ||
    p.startsWith("/tenant-setup/")
  );
}

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

const PageFallback = (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
  </div>
);

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
  // Public booking/gallery pages can render immediately without waiting for the
  // server sync (they fetch their own data directly via API calls).
  const [ready, setReady] = useState(isPublicRoute());

  useEffect(() => {
    if (isPublicRoute()) return; // Skip sync for routes that don't need it
    syncFromServer().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return PageFallback;
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
        <BrowserRouter>
          <Suspense fallback={PageFallback}>
            <Routes>
              <Route path="/" element={<Booking />} />
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
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
