import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "conn.uploader.capture",
  appName: "Zuploader Capture",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
