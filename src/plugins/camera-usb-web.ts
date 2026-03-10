/**
 * Web fallback for CameraUsbPlugin — uses standard file picker since
 * USB MTP access is only available on native Android.
 */
import { WebPlugin } from "@capacitor/core";
import type { CameraUsbPlugin, CameraFile } from "./camera-usb";

export class CameraUsbWeb extends WebPlugin implements CameraUsbPlugin {
  async isConnected() {
    return { connected: false, deviceName: "Web — use file picker" };
  }

  async requestPermission() {
    return { granted: false };
  }

  async listFiles(_options: { limit?: number }): Promise<{ files: CameraFile[] }> {
    console.warn("CameraUsb: listFiles not available on web");
    return { files: [] };
  }

  async importFile(_options: { handle: number; fileName: string }) {
    console.warn("CameraUsb: importFile not available on web");
    return { uri: "", localPath: "" };
  }

  async importFiles(_options: { handles: number[] }) {
    console.warn("CameraUsb: importFiles not available on web");
    return { files: [] };
  }

  async deleteLocalFiles(_options: { paths: string[] }) {
    console.warn("CameraUsb: deleteLocalFiles not available on web");
    return { deleted: 0 };
  }

  async reconnect() {
    console.warn("CameraUsb: reconnect not available on web");
    return { granted: false };
  }

  async startWatching(_options?: { intervalMs?: number }) {
    console.warn("CameraUsb: watching not available on web");
  }

  async stopWatching() {
    // no-op on web
  }
}
