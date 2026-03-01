import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import Booking from "./pages/Booking";
import AlbumDetail from "./pages/AlbumDetail";
import BookingModify from "./pages/BookingModify";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import { isSetupComplete, isLoggedIn } from "./lib/storage";
import { syncFromServer } from "./lib/api";

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

  useEffect(() => {
    syncFromServer().finally(() => setReady(true));
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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Booking />} />
            <Route path="/gallery/:albumId" element={<AlbumDetail />} />
            <Route path="/booking/modify/:bookingId" element={<BookingModify />} />
            <Route path="/admin" element={<AdminGuard />} />
            <Route path="/admin/:tab" element={<AdminGuard />} />
            <Route path="/admin/storage" element={<AdminGuard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
