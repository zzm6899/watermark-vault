import type { CapacitorConfig } from "@capacitor/cli";

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
