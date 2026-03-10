/**
 * Capacitor plugin interface for USB MTP camera access (Nikon Z6III etc.)
 * 
 * The native Kotlin implementation uses Android's MtpDevice API to:
 * 1. Detect USB-connected cameras
 * 2. List image files from the camera's storage
 * 3. Import files to local storage
 * 
 * On web (non-native), falls back to standard file picker.
 */
import { registerPlugin } from "@capacitor/core";

export interface CameraFile {
  /** MTP object handle */
  handle: number;
  /** Original filename from camera */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Date modified (epoch ms) */
  dateModified: number;
}

export interface CameraUsbPlugin {
  /** Check if a USB camera is connected */
  isConnected(): Promise<{ connected: boolean; deviceName: string }>;

  /** Request USB permission if not already granted */
  requestPermission(): Promise<{ granted: boolean }>;

  /** List the latest N image files from the camera (newest first) */
  listFiles(options: { limit?: number; jpegOnly?: boolean }): Promise<{ files: CameraFile[] }>;

  /** Import a file from the camera to local storage. Returns local file URI */
  importFile(options: { handle: number; fileName: string }): Promise<{ uri: string; localPath: string }>;

  /** Import multiple files. Returns array of local file URIs */
  importFiles(options: { handles: number[] }): Promise<{ files: Array<{ handle: number; uri: string; localPath: string; base64?: string; mimeType?: string }> }>;

  /** Delete local cached copies of imported files (call after successful server upload) */
  deleteLocalFiles(options: { paths: string[] }): Promise<{ deleted: number }>;

  /** Start watching for new files on camera (polling). Emits 'newFiles' event */
  startWatching(options: { intervalMs?: number }): Promise<void>;

  /** Stop watching for new files */
  stopWatching(): Promise<void>;

  /** Listen for events (e.g. 'newFiles') */
  addListener(eventName: string, callback: (data: any) => void): Promise<{ remove: () => void }>;
}

const CameraUsb = registerPlugin<CameraUsbPlugin>("CameraUsb", {
  web: () => import("./camera-usb-web").then((m) => new m.CameraUsbWeb()),
});

export default CameraUsb;
