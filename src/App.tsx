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
    p.startsWith("/tenant-setup/") ||
    p === "/login"
  );
}

function AdminGuard() {
  const [, rerender] = useState(0);
  const refresh = useCallback(() => rerender((n) => n + 1), []);

  if (!isSetupComplete()) {
    return <Setup onComplete={refresh} />;
  }
  if (!isLoggedIn()) {
    return <LoginPage onLogin={refresh} />;
  }
  return <Admin />;
}

const PageFallback = (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
  </div>
);

const App = () => {
  const [ready, setReady] = useState(isPublicRoute());
  const [customDomainSlug, setCustomDomainSlug] = useState<string | null>(null);

  useEffect(() => {
    // Public booking/gallery pages can render immediately without waiting for the
    // server sync (they fetch their own data directly via API calls).
    if (isPublicRoute()) return;

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

  // Re-sync from the server whenever the app is brought back to the foreground
  // (e.g. Android/iOS app resume or switching back to this browser tab).  This
  // ensures the admin gallery and other views always show the latest data without
  // requiring a manual force-refresh of the app.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || isPublicRoute()) return;
      syncFromServer().then(() => {
        window.dispatchEvent(new CustomEvent("storage-synced"));
      }).catch(() => { /* non-critical: best-effort background refresh */ });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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
            <Suspense fallback={PageFallback}>
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
                <Route path="/invoice/:token" element={<InvoiceView />} />
                <Route path="/tenant-setup/:token" element={<TenantSetup />} />
                <Route path="/tenant-admin/:slug" element={<TenantAdmin />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </CustomDomainContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
