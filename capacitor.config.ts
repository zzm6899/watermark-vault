import type { CapacitorConfig } from "@capacitor/cli";

// IMPORTANT - server.url is set to the live server, which means the Capacitor
// WebView loads ALL web content (React app) directly from that remote URL at
// runtime rather than from the locally-bundled `dist` folder.
//
// Consequence for deployments:
//   Web-only changes (React/TypeScript in src/): just push to main.
//     CI builds a new Docker image and the server is updated. The next time
//     the Android app opens it automatically picks up the new code.
//     No APK rebuild required.
//
//   Native changes - APK rebuild IS required for:
//     - AndroidManifest.xml
//     - MainActivity.java
//     - CameraUsbPlugin.kt (or any other native plugin)
//     - This file (capacitor.config.ts) - e.g. changing server.url
//     - Gradle / build files in android/
//     Rebuild the APK and distribute a new release in those cases.

const config: CapacitorConfig = {
  appId: "conn.uploader",
  appName: "Zuploader",
  webDir: "dist",
  server: {
    url: "https://book.zacmclients.photos/login",
    cleartext: true,
  },
};

export default config;
