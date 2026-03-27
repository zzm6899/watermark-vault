/**
 * usePwa — hooks for PWA service worker registration, push notification
 * subscription, and the offline capture queue (IndexedDB-backed).
 */

import { useEffect, useRef, useCallback } from "react";
import { subscribePush, unsubscribePush, getVapidPublicKey } from "./api";

// ─── Service Worker Registration ─────────────────────────────────────────────

export function useServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] Registered", reg.scope);
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
  }, []);
}

// ─── Push Notification Subscription ──────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function subscribeToPush(tenantSlug?: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[Push] Not supported");
    return false;
  }
  try {
    const vapidKey = await getVapidPublicKey();
    if (!vapidKey) {
      console.warn("[Push] No VAPID public key configured on server");
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await subscribePush(existing, tenantSlug);
      return true;
    }
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    return subscribePush(subscription, tenantSlug);
  } catch (err) {
    console.error("[Push] Subscribe error:", err);
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    await unsubscribePush(sub.endpoint);
    await sub.unsubscribe();
    return true;
  } catch (err) {
    console.error("[Push] Unsubscribe error:", err);
    return false;
  }
}

export async function getPushPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

// ─── Offline Capture Queue (IndexedDB) ───────────────────────────────────────

const IDB_NAME = "photoflow-offline";
const IDB_STORE = "capture-queue";
const IDB_VERSION = 1;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface OfflineCaptureItem {
  id: string;
  albumId?: string;
  file: Blob;
  fileName: string;
  mimeType: string;
  queuedAt: string;
  status: "queued" | "uploading" | "done" | "error";
  errorMessage?: string;
}

export async function queueOfflineCapture(item: Omit<OfflineCaptureItem, "id" | "queuedAt" | "status">): Promise<string> {
  const db = await openIdb();
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const record: OfflineCaptureItem = {
    ...item,
    id,
    queuedAt: new Date().toISOString(),
    status: "queued",
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineQueue(): Promise<OfflineCaptureItem[]> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function updateOfflineItem(id: string, updates: Partial<OfflineCaptureItem>): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) { resolve(); return; }
      store.put({ ...item, ...updates });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeOfflineItem(id: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * useOfflineUploadQueue — listens for online events and flushes the IndexedDB
 * queue automatically when connectivity is restored.
 *
 * @param uploadFn - function that takes an OfflineCaptureItem and uploads it to the server
 */
export function useOfflineUploadQueue(
  uploadFn: (item: OfflineCaptureItem) => Promise<boolean>
) {
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      const queue = await getOfflineQueue();
      const pending = queue.filter((i) => i.status === "queued" || i.status === "error");
      for (const item of pending) {
        await updateOfflineItem(item.id, { status: "uploading" });
        try {
          const ok = await uploadFn(item);
          if (ok) {
            await removeOfflineItem(item.id);
          } else {
            await updateOfflineItem(item.id, { status: "error", errorMessage: "Upload failed" });
          }
        } catch (err) {
          await updateOfflineItem(item.id, { status: "error", errorMessage: String(err) });
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [uploadFn]);

  useEffect(() => {
    const handleOnline = () => flush();
    window.addEventListener("online", handleOnline);

    // Listen for messages from service worker (background sync)
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "FLUSH_UPLOAD_QUEUE") flush();
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);

    // Auto-flush on mount if online
    if (navigator.onLine) flush();

    return () => {
      window.removeEventListener("online", handleOnline);
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
    };
  }, [flush]);

  return { flush };
}
