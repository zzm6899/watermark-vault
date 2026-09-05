import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { Capacitor } from "@capacitor/core";
import { isSetupComplete, isLoggedIn, logout } from "./lib/storage";
import { ADMIN_API_TOKEN_KEY, syncFromServer, getTenantByDomain, NATIVE_API_ORIGIN, verifyAdminSession } from "./lib/api";
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
const PortfolioSite = lazyWithReload(() => import("./pages/PortfolioSite"));
const ProofingDemo = lazyWithReload(() => import("./pages/ProofingDemo"));
const ClientPortal = lazyWithReload(() => import("./pages/ClientPortal"));

const queryClient = new QueryClient();

function installNativeApiFetchPrefix() {
  if (!(window as any).__wvNativeFetchPrefixInstalled) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/")) {
        const headers = new Headers(init?.headers);
        let nativeToken = "";
        try {
          nativeToken = localStorage.getItem(ADMIN_API_TOKEN_KEY)
            || localStorage.getItem("wv_tenant_api_token")
            || "";
        } catch { /* unavailable */ }
        if (nativeToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${nativeToken}`);
        return originalFetch(`${NATIVE_API_ORIGIN}${input}`, { ...init, headers, credentials: "include" });
      }
      if (typeof input === "string" && input.startsWith("/uploads/")) {
        return originalFetch(`${NATIVE_API_ORIGIN}${input}`, { ...init, credentials: "include" });
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
    p === "/" ||
    p.startsWith("/book/") ||
    p.startsWith("/booking/modify/") ||
    p.startsWith("/gallery/") ||
    p === "/my-gallery" ||
    p === "/demo/proofing" ||
    p.startsWith("/invoice/") ||
    p.startsWith("/quote/") ||
    p.startsWith("/contract/") ||
    p.startsWith("/tenant-setup/") ||
    p.startsWith("/portfolio-preview") ||
    p === "/portfolio" ||
    p === "/events" ||
    p === "/concert" ||
    p === "/concerts" ||
    p === "/about" ||
    p === "/testimonials" ||
    p === "/enquire" ||
    p === "/contact" ||
    p === "/login"
  );
}

function AdminGuard() {
  const [, rerender] = useState(0);
  const [serverSession, setServerSession] = useState<"checking" | "valid" | "invalid">(
    () => isLoggedIn() ? "checking" : "invalid",
  );
  const localLoggedIn = isLoggedIn();
  const refresh = useCallback(() => {
    setServerSession("checking");
    rerender((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!localLoggedIn) return;
    let cancelled = false;
    setServerSession("checking");
    void verifyAdminSession()
      .then(async valid => {
        if (cancelled) return;
        if (valid) {
          await syncFromServer({ awaitLazy: true }).catch(() => false);
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent("storage-synced"));
          setServerSession("valid");
        }
        else {
          logout();
          setServerSession("invalid");
        }
      })
      .catch(() => {
        if (cancelled) return;
        logout();
        setServerSession("invalid");
      });
    return () => { cancelled = true; };
  }, [localLoggedIn]);

  if (!isSetupComplete()) {
    return <Setup onComplete={refresh} />;
  }
  if (!localLoggedIn || serverSession === "invalid") {
    return <LoginPage onLogin={refresh} />;
  }
  if (serverSession === "checking") {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-pulse text-muted-foreground font-body text-sm">Verifying admin session…</div></div>;
  }
  return <Admin />;
}

function AlbumRoute() {
  const { albumId } = useParams();
  // React Router reuses route elements across parameter changes. The key makes
  // every gallery state bucket (PIN, email, selections, lightbox, quota) album-scoped.
  return <AlbumDetail key={albumId || "missing-album"} />;
}

async function syncPublicConfig(): Promise<void> {
  const response = await fetch("/api/public/config", { cache: "no-store" });
  if (!response.ok) throw new Error(`Public config request failed (${response.status})`);
  const payload = await response.json() as Record<string, unknown>;
  const publicSettings = payload.settings && typeof payload.settings === "object"
    ? payload.settings as Record<string, unknown>
    : {};
  const safeEntries: Array<[string, unknown]> = [
    ["wv_setup_complete", payload.setupComplete ?? payload.setup_complete ?? publicSettings.setupComplete],
    ["wv_profile", payload.profile],
    ["wv_settings", payload.settings],
    ["wv_event_types", payload.eventTypes ?? payload.event_types],
  ];
  for (const [key, value] of safeEntries) {
    if (value !== undefined && value !== null) localStorage.setItem(key, JSON.stringify(value));
  }
  window.dispatchEvent(new CustomEvent("storage-synced"));
}

const PageFallback = (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
  </div>
);

const App = () => {
  const isNativeApp = Capacitor.isNativePlatform();
  if (isNativeApp) installNativeApiFetchPrefix();
  const [ready, setReady] = useState(isNativeApp);
  const [customDomainSlug, setCustomDomainSlug] = useState<string | null>(null);
  const [siteRole, setSiteRole] = useState<"platform" | "portfolio" | "tenant-booking">("platform");

  useEffect(() => {
    if (isNativeApp) {
      installNativeApiFetchPrefix();
      return;
    }
    const hostname = window.location.hostname;
    // Skip domain resolution for localhost / loopback / private IP access
    const isLocalAccess =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

    // Bootstrap every browser from the sanitized config so a fresh visit knows
    // whether setup is complete before login. Only an existing authenticated
    // admin session may request the protected generic stores.
    const tasks: Promise<unknown>[] = [syncPublicConfig()];
    if (!isPublicRoute() && isLoggedIn()) tasks.push(syncFromServer());
    if (!isLocalAccess) {
      tasks.push(
        fetch("/api/site-context").then(r => r.ok ? r.json() : null).then((context) => {
          if (context?.role === "portfolio") setSiteRole("portfolio");
          if (context?.role === "tenant-booking" && context.tenantSlug) {
            setSiteRole("tenant-booking");
            setCustomDomainSlug(context.tenantSlug);
          }
        }).catch(() => getTenantByDomain(hostname).then((result) => {
          if (result?.slug) { setSiteRole("tenant-booking"); setCustomDomainSlug(result.slug); }
        }))
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
      if (document.visibilityState !== "visible" || isPublicRoute() || !isLoggedIn()) return;
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
                  element={isNativeApp ? <MobileCapture /> : siteRole === "portfolio" ? <PortfolioSite /> : customDomainSlug ? <TenantBookingPage overrideSlug={customDomainSlug} /> : <Booking />}
                />
                <Route path="/portfolio-preview/*" element={<PortfolioSite />} />
                <Route path="/portfolio" element={<PortfolioSite />} />
                <Route path="/events" element={<PortfolioSite />} />
                <Route path="/concert" element={<PortfolioSite />} />
                <Route path="/concerts" element={<PortfolioSite />} />
                <Route path="/about" element={<PortfolioSite />} />
                <Route path="/testimonials" element={<PortfolioSite />} />
                <Route path="/enquire" element={<PortfolioSite />} />
                <Route path="/contact" element={<PortfolioSite />} />
                <Route path="/book/:tenantSlug" element={<TenantBookingPage />} />
                <Route path="/gallery/:albumId" element={<AlbumRoute />} />
                <Route path="/my-gallery" element={<ClientPortal />} />
                <Route path="/demo/proofing" element={<ProofingDemo />} />
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
