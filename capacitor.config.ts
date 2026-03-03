import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.watermarkmuse",
  appName: "watermark-muse",
  webDir: "dist",
  server: {
    url: "https://book.zacmclients.photos/admin",
    cleartext: true,
  },
};

export default config;
