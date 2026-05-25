import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { Capacitor } from "@capacitor/core";
import { isSetupComplete, isLoggedIn } from "./lib/storage";
import { syncFromServer, getTenantByDomain, NATIVE_API_ORIGIN } from "./lib/api";
import { CustomDomainContext } from "./lib/custom-domain-context";

// Eagerly load the public-facing booking page so it renders with zero extra round-trips.
import TenantBookingPage from "./pages/TenantBookingPage";

const LAZY_RELOAD_KEY = "wv_lazy_reload_attempted";

function isLazyChunkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
}

function lazyWithReload<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  return lazy(() =>
    loader()
      .then((module) => {
        sessionStorage.removeItem(LAZY_RELOAD_KEY);
        return module;
      })
      .catch((error) => {
        if (typeof window !== "undefined" && isLazyChunkError(error) && sessionStorage.getItem(LAZY_RELOAD_KEY) !== "1") {
          sessionStorage.setItem(LAZY_RELOAD_KEY, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw error;
      })
  );
}

// Lazily load everything else — these are only needed by admin / gallery users.
const Booking = lazyWithReload(() => import("./pages/Booking"));
const AlbumDetail = lazyWithReload(() => import("./pages/AlbumDetail"));
const BookingModify = lazyWithReload(() => import("./pages/BookingModify"));
const Admin = lazyWithReload(() => import("./pages/Admin"));
const Setup = lazyWithReload(() => import("./pages/Setup"));
const NotFound = lazyWithReload(() => import("./pages/NotFound"));
const MobileCapture = lazyWithReload(() => import("./pages/MobileCapture"));
const InvoiceView = lazyWithReload(() => import("./pages/InvoiceView"));
const QuoteView = lazyWithReload(() => import("./pages/QuoteView"));
const ContractSign = lazyWithReload(() => import("./pages/ContractSign"));
const TenantSetup = lazyWithReload(() => import("./pages/TenantSetup"));
const TenantAdmin = lazyWithReload(() => import("./pages/TenantAdmin"));
const LoginPage = lazyWithReload(() => import("./pages/LoginPage"));

const queryClient = new QueryClient();

function installNativeApiFetchPrefix() {
  if (!(window as any).__wvNativeFetchPrefixInstalled) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/")) {
        return originalFetch(`${NATIVE_API_ORIGIN}${input}`, init);
      }
      if (typeof input === "string" && input.startsWith("/uploads/")) {
        return originalFetch(`${NATIVE_API_ORIGIN}${input}`, init);
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
    (window as any).__wvNativeFetchPrefixInstalled = true;
  }
}

/** Routes that don't need the server sync before rendering */
function isPublicRoute(): boolean {
  const p = window.location.pathname;
  return (
    p.startsWith("/book/") ||
    p.startsWith("/gallery/") ||
    p.startsWith("/invoice/") ||
    p.startsWith("/quote/") ||
    p.startsWith("/contract/") ||
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
  const isNativeApp = Capacitor.isNativePlatform();
  if (isNativeApp) installNativeApiFetchPrefix();
  const [ready, setReady] = useState(isNativeApp || isPublicRoute());
  const [customDomainSlug, setCustomDomainSlug] = useState<string | null>(null);

  useEffect(() => {
    if (isNativeApp) {
      installNativeApiFetchPrefix();
      return;
    }
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
  }, [isNativeApp]);

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
                  element={isNativeApp ? <MobileCapture /> : customDomainSlug ? <TenantBookingPage overrideSlug={customDomainSlug} /> : <Booking />}
                />
                <Route path="/book/:tenantSlug" element={<TenantBookingPage />} />
                <Route path="/gallery/:albumId" element={<AlbumDetail />} />
                <Route path="/booking/modify/:bookingId" element={<BookingModify />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/capture" element={<MobileCapture />} />
                <Route path="/admin" element={<AdminGuard />} />
                <Route path="/admin/:tab" element={<AdminGuard />} />
                <Route path="/invoice/:token" element={<InvoiceView />} />
                <Route path="/quote/:token" element={<QuoteView />} />
                <Route path="/contract/:token" element={<ContractSign />} />
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
