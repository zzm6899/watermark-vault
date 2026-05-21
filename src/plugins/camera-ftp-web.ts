import { WebPlugin } from "@capacitor/core";
import type { CameraFtpPlugin, CameraFtpStatus } from "./camera-ftp";

const fallbackStatus: CameraFtpStatus = {
  running: false,
  paused: false,
  host: "0.0.0.0",
  port: 2121,
  username: "camera",
  password: "camera",
  receivedCount: 0,
};

export class CameraFtpWeb extends WebPlugin implements CameraFtpPlugin {
  async start() { return fallbackStatus; }
  async stop() {}
  async pause() {}
  async resume() {}
  async status() { return fallbackStatus; }
  async getNetworkInfo() { return { addresses: [], hotspotLikelyAddress: "192.168.43.1", ipAddress: "192.168.43.1" }; }
  async scanNetwork() { return { serverHost: "192.168.43.1", serverPort: 2121, subnet: "192.168.43.0/24", candidates: [] }; }
  async openHotspotSettings() {}
  async importFiles() { return { files: [] }; }
  async deleteLocalFiles() { return { deleted: 0 }; }
}
