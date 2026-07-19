import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const portfolioHosts = new Set(["zacmorganphotography.com", "www.zacmorganphotography.com"]);

// Keep the booking PWA isolated from the public portfolio host.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (portfolioHosts.has(window.location.hostname)) {
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("photoflow-")).map((key) => caches.delete(key))),
        );
      }
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("[SW] Registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
