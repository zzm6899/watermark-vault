import { registerPlugin } from "@capacitor/core";

export interface CameraFtpFile {
  path: string;
  localPath?: string;
  name: string;
  mimeType: string;
  size: number;
  dateModified: number;
}

export interface CameraFtpCandidate {
  ipAddress: string;
  macAddress?: string;
  interfaceName?: string;
  label?: string;
}

export interface CameraFtpStatus {
  running: boolean;
  paused: boolean;
  host?: string;
  ipAddress?: string;
  port: number;
  username?: string;
  password?: string;
  receivedCount?: number;
  root?: string;
  activeClientCount?: number;
  lastClientAddress?: string;
  lastClientStatus?: string;
  lastCommand?: string;
  lastError?: string;
  clients?: Array<{
    ipAddress: string;
    firstSeen?: number;
    lastSeen?: number;
    connected?: boolean;
    authState?: string;
    usernameAttempt?: string;
    lastCommand?: string;
    lastError?: string;
    filesReceived?: number;
    lastTransferName?: string;
    lastTransferBytes?: number;
    lastTransferAt?: number;
  }>;
  network?: {
    addresses?: string[];
    hotspotLikelyAddress?: string;
    ipAddress?: string;
    activeIpAddress?: string;
  };
}

export interface CameraFtpPlugin {
  start(options?: { port?: number; username?: string; password?: string }): Promise<CameraFtpStatus>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  status(): Promise<CameraFtpStatus>;
  getNetworkInfo(): Promise<{ addresses?: string[]; hotspotLikelyAddress?: string; ipAddress?: string; activeIpAddress?: string; ftpUrl?: string }>;
  scanNetwork(options?: { timeoutMs?: number }): Promise<{ serverHost?: string; serverPort?: number; subnet?: string; candidates: CameraFtpCandidate[] }>;
  openHotspotSettings(): Promise<void>;
  importFiles(options: { paths: string[] }): Promise<{ files: Array<CameraFtpFile & { base64?: string }> }>;
  deleteLocalFiles(options: { paths: string[] }): Promise<{ deleted: number }>;
  addListener(eventName: "newFiles", callback: (data: { files: CameraFtpFile[] }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: "statusChanged", callback: (data: CameraFtpStatus) => void): Promise<{ remove: () => void }>;
}

const CameraFtp = registerPlugin<CameraFtpPlugin>("CameraFtp", {
  web: () => import("./camera-ftp-web").then((m) => new m.CameraFtpWeb()),
});

export default CameraFtp;
